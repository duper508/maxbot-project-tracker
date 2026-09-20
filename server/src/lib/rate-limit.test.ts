import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests under the max attempts", () => {
    const limiter = new RateLimiter({ maxAttempts: 3, windowMs: 60_000, lockoutMs: 15 * 60_000 });
    expect(limiter.attempt("ip:1:2:3")).toEqual({ allowed: true });
    expect(limiter.attempt("ip:1:2:3")).toEqual({ allowed: true });
    expect(limiter.attempt("ip:1:2:3")).toEqual({ allowed: true });
  });

  it("blocks the first request over the limit and reports retry-after", () => {
    const limiter = new RateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 15 * 60_000 });
    limiter.attempt("ip:1:2:3");
    limiter.attempt("ip:1:2:3");
    const result = limiter.attempt("ip:1:2:3");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterMs).toBe(15 * 60_000);
    }
  });

  it("keeps a key locked until the lockout expires", () => {
    const limiter = new RateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 15 * 60_000 });
    limiter.attempt("ip:1:2:3");
    limiter.attempt("ip:1:2:3");
    expect(limiter.attempt("ip:1:2:3").allowed).toBe(false);

    vi.advanceTimersByTime(14 * 60_000);
    expect(limiter.attempt("ip:1:2:3").allowed).toBe(false);

    vi.advanceTimersByTime(2 * 60_000);
    expect(limiter.attempt("ip:1:2:3")).toEqual({ allowed: true });
  });

  it("resets after the lockout expires", () => {
    const limiter = new RateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 15 * 60_000 });
    limiter.attempt("ip:1:2:3");
    limiter.attempt("ip:1:2:3");
    expect(limiter.attempt("ip:1:2:3").allowed).toBe(false);

    vi.advanceTimersByTime(15 * 60_000 + 1);
    expect(limiter.attempt("ip:1:2:3")).toEqual({ allowed: true });
  });

  it("isolates keys", () => {
    const limiter = new RateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 15 * 60_000 });
    limiter.attempt("ip:1:2:3");
    limiter.attempt("ip:1:2:3");
    expect(limiter.attempt("ip:1:2:3").allowed).toBe(false);
    expect(limiter.attempt("ip:5:6:7")).toEqual({ allowed: true });
  });

  it("reset clears the lockout", () => {
    const limiter = new RateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 15 * 60_000 });
    limiter.attempt("ip:1:2:3");
    limiter.attempt("ip:1:2:3");
    expect(limiter.attempt("ip:1:2:3").allowed).toBe(false);

    limiter.reset("ip:1:2:3");
    expect(limiter.attempt("ip:1:2:3")).toEqual({ allowed: true });
  });

  it("reports remaining lockout time", () => {
    const limiter = new RateLimiter({ maxAttempts: 2, windowMs: 60_000, lockoutMs: 15 * 60_000 });
    limiter.attempt("ip:1:2:3");
    limiter.attempt("ip:1:2:3");
    limiter.attempt("ip:1:2:3");

    vi.advanceTimersByTime(5 * 60_000);
    const remaining = limiter.lockedRemainingMs("ip:1:2:3");
    expect(remaining).toBeGreaterThan(9 * 60_000);
    expect(remaining).toBeLessThanOrEqual(10 * 60_000);
  });
});
