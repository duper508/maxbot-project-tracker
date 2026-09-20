import { isIP } from "node:net";
import type { Context, Next } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { config } from "../config.js";
import { KanbanError } from "./errors.js";

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  lockoutMs: number;
  /** Maximum number of in-memory buckets. Defaults to 10,000. */
  maxBuckets?: number;
}

interface Bucket {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
}

function ipToBytes(ip: string): number[] | null {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return null;
    }
    return parts;
  }
  if (family === 6) {
    let expanded = ip;
    if (expanded.includes("::")) {
      const [left, right] = expanded.split("::");
      const leftParts = left ? left.split(":") : [];
      const rightParts = right ? right.split(":") : [];
      const missing = 8 - leftParts.length - rightParts.length;
      if (missing < 0) return null;
      expanded = [...leftParts, ...Array(missing).fill("0"), ...rightParts].join(":");
    }
    const groups = expanded.split(":").map((p) => parseInt(p, 16));
    if (groups.length !== 8 || groups.some((p) => Number.isNaN(p) || p < 0 || p > 0xffff)) {
      return null;
    }
    const bytes: number[] = [];
    for (const g of groups) {
      bytes.push((g >> 8) & 0xff, g & 0xff);
    }
    return bytes;
  }
  return null;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split("/");
  const prefix = parseInt(prefixStr ?? "", 10);
  if (Number.isNaN(prefix) || !network) return false;

  const ipBytes = ipToBytes(ip);
  const netBytes = ipToBytes(network);
  if (!ipBytes || !netBytes || ipBytes.length !== netBytes.length) return false;

  const totalBits = ipBytes.length === 4 ? 32 : 128;
  if (prefix < 0 || prefix > totalBits) return false;

  let bitsRemaining = prefix;
  for (let i = 0; i < ipBytes.length; i++) {
    if (bitsRemaining <= 0) return true;
    if (bitsRemaining >= 8) {
      if (ipBytes[i] !== netBytes[i]) return false;
      bitsRemaining -= 8;
    } else {
      const mask = (0xff << (8 - bitsRemaining)) & 0xff;
      if ((ipBytes[i] & mask) !== (netBytes[i] & mask)) return false;
      return true;
    }
  }
  return true;
}

function forwardedClientIp(forwarded: string): string | undefined {
  const parts = forwarded
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  // A trusted reverse proxy (e.g. Caddy) appends the real client address to the
  // end of the X-Forwarded-For list. Reading the first element trusts the client.
  const last = parts[parts.length - 1];
  return last && isIP(last) !== 0 ? last : undefined;
}

let warnedAboutUnknownPeer = false;

export function clientIp(c: Context, trustedProxyCidr?: string): string {
  let peer: string;
  try {
    peer = getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // getConnInfo only works when the request came through @hono/node-server.
    // Tests and other non-Node environments fall back to a shared "unknown" key.
    peer = "unknown";
  }

  if (peer === "unknown" && !warnedAboutUnknownPeer && config.NODE_ENV === "production") {
    warnedAboutUnknownPeer = true;
    console.warn(
      "[rate-limit] Could not determine socket peer address; rate limits will share a single 'unknown' key. " +
        "Ensure the server is running through @hono/node-server.",
    );
  }

  const cidr = trustedProxyCidr ?? config.TRUSTED_PROXY_CIDR;
  if (cidr && isIpInCidr(peer, cidr)) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const realIp = forwardedClientIp(forwarded);
      if (realIp) return realIp;
    }
  }
  return peer;
}

function nowMs(): number {
  return Date.now();
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private maxBuckets: number;

  constructor(private config: RateLimitConfig) {
    this.maxBuckets = config.maxBuckets ?? 10_000;
  }

  private prune(): void {
    const cutoff = nowMs() - this.config.windowMs - this.config.lockoutMs;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.firstAttemptAt < cutoff) {
        this.buckets.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.firstAttemptAt < oldestTime) {
        oldestTime = bucket.firstAttemptAt;
        oldestKey = key;
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey);
  }

  private enforceBucketCap(): void {
    if (this.buckets.size < this.maxBuckets) return;
    this.prune();
    if (this.buckets.size < this.maxBuckets) return;
    this.evictOldest();
  }

  private getBucket(key: string): Bucket {
    const existing = this.buckets.get(key);
    if (existing) return existing;
    this.enforceBucketCap();
    const bucket: Bucket = { attempts: 0, firstAttemptAt: 0, lockedUntil: 0 };
    this.buckets.set(key, bucket);
    return bucket;
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
