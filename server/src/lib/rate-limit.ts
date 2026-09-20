import type { Context, Next } from "hono";
import { KanbanError } from "./errors.js";

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
}

interface Bucket {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp;
  return "unknown";
}

function nowMs(): number {
  return Date.now();
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private config: RateLimitConfig) {}

  private getBucket(key: string): Bucket {
    const existing = this.buckets.get(key);
    if (existing) return existing;
    const bucket: Bucket = { attempts: 0, firstAttemptAt: 0, lockedUntil: 0 };
    this.buckets.set(key, bucket);
    return bucket;
  }

  private prune(): void {
    const cutoff = nowMs() - this.config.windowMs - this.config.lockoutMs;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.firstAttemptAt < cutoff) {
        this.buckets.delete(key);
      }
    }
  }

  /**
   * Records an attempt and returns whether the caller is currently allowed to proceed.
   * When a lockout is active, returns the remaining lockout milliseconds.
   */
  attempt(key: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    this.prune();
    const bucket = this.getBucket(key);
    const now = nowMs();

    if (bucket.lockedUntil > now) {
      return { allowed: false, retryAfterMs: bucket.lockedUntil - now };
    }

    // Reset the window if the current attempt is outside it.
    if (bucket.firstAttemptAt === 0 || now - bucket.firstAttemptAt > this.config.windowMs) {
      bucket.attempts = 0;
      bucket.firstAttemptAt = now;
    }

    bucket.attempts += 1;

    if (bucket.attempts > this.config.maxAttempts) {
      bucket.lockedUntil = now + this.config.lockoutMs;
      return { allowed: false, retryAfterMs: this.config.lockoutMs };
    }

    return { allowed: true };
  }

  /** Clears any lockout for the key, e.g. after a successful login. */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Returns the current lockout remaining for a key, or 0. */
  lockedRemainingMs(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    const remaining = bucket.lockedUntil - nowMs();
    return remaining > 0 ? remaining : 0;
  }
}

export interface RateLimitMiddlewareConfig {
  limiter: RateLimiter;
  key: (c: Context) => string;
  onSuccess?: (c: Context) => string | undefined;
}

export function rateLimitMiddleware(config: RateLimitMiddlewareConfig) {
  return async (c: Context, next: Next) => {
    const key = config.key(c);
    const result = config.limiter.attempt(key);
    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
      c.header("Retry-After", String(retryAfterSeconds));
      throw new KanbanError(
        `Too many attempts. Try again in ${retryAfterSeconds}s.`,
        429,
        "RATE_LIMITED",
      );
    }
    await next();
    if (config.onSuccess) {
      const successKey = config.onSuccess(c);
      if (successKey) config.limiter.reset(successKey);
    }
  };
}

// ---------------------------------------------------------------------------
// Pre-configured limiters for A1
// ---------------------------------------------------------------------------

/** Primary control: throttles repeated requests from the same IP. */
export const ipLimiter = new RateLimiter({
  maxAttempts: 10,
  windowMs: 60_000,
  lockoutMs: 15 * 60_000,
});

/** Secondary control for login: per-account lockout keyed on IP + email. */
export const accountLoginLimiter = new RateLimiter({
  maxAttempts: 5,
  windowMs: 60_000,
  lockoutMs: 15 * 60_000,
});

export function ipRateLimitKey(c: Context): string {
  return `ip:${clientIp(c)}`;
}

export function loginRateLimitKey(c: Context): string {
  // Email is parsed from the JSON body, but reading the body here is awkward.
  // The auth route uses the account limiter directly; this key builder is a fallback.
  return `login:${clientIp(c)}`;
}
