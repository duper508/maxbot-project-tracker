import { describe, it, expect, vi, beforeEach } from "vitest";
import { getConnInfo } from "@hono/node-server/conninfo";
import { RateLimiter, clientIp, ipRateLimitKey, loginRateLimitKey } from "./rate-limit.js";

vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: vi.fn(),
}));

function mockPeer(address: string) {
  vi.mocked(getConnInfo).mockReturnValue({
    remote: { address, addressType: address.includes(":") ? "IPv6" : "IPv4", port: 12345 },
  } as ReturnType<typeof getConnInfo>);
}

function mockContext(headers: Record<string, string> = {}) {
  return {
    req: {
      header: (name: string) => headers[name.toLowerCase()],
    },
  } as Parameters<typeof clientIp>[0];
}

describe("clientIp", () => {
  it("uses the socket peer address by default", () => {
    mockPeer("203.0.113.5");
    const c = mockContext({ "x-forwarded-for": "1.2.3.4" });
    expect(clientIp(c)).toBe("203.0.113.5");
  });

  it("ignores XFF when the peer is not in the trusted proxy CIDR", () => {
    mockPeer("203.0.113.5");
    const c = mockContext({ "x-forwarded-for": "1.2.3.4" });
    expect(clientIp(c, "127.0.0.1/32")).toBe("203.0.113.5");
  });

  it("honors the last XFF entry when the peer is a trusted proxy", () => {
    mockPeer("127.0.0.1");
    const c = mockContext({ "x-forwarded-for": "1.2.3.4, 198.51.100.10, 10.0.0.1" });
    expect(clientIp(c, "127.0.0.1/32")).toBe("10.0.0.1");
  });

  it("falls back to the peer address when XFF is absent or empty", () => {
    mockPeer("127.0.0.1");
    expect(clientIp(mockContext(), "127.0.0.1/32")).toBe("127.0.0.1");
    expect(clientIp(mockContext({ "x-forwarded-for": "" }), "127.0.0.1/32")).toBe("127.0.0.1");
  });

  it("supports IPv6 trusted proxy CIDRs", () => {
    mockPeer("::1");
    const c = mockContext({ "x-forwarded-for": "2001:db8::1" });
    expect(clientIp(c, "::1/128")).toBe("2001:db8::1");
  });

  it("uses the socket peer for IPv4-mapped IPv6 addresses when trusted", () => {
    mockPeer("::ffff:127.0.0.1");
    const c = mockContext({ "x-forwarded-for": "1.2.3.4" });
    expect(clientIp(c, "127.0.0.1/32")).toBe("::ffff:127.0.0.1");
  });

  it("builds rate-limit keys from the resolved client IP", () => {
    mockPeer("203.0.113.5");
    const c = mockContext();
    expect(ipRateLimitKey(c)).toBe("ip:203.0.113.5");
    expect(loginRateLimitKey(c)).toBe("login:203.0.113.5");
  });
});

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

  it("caps the in-memory bucket map and evicts the oldest entry", () => {
    const limiter = new RateLimiter({ maxAttempts: 1, windowMs: 60_000, lockoutMs: 15 * 60_000, maxBuckets: 2 });

    vi.setSystemTime(1_000);
    expect(limiter.attempt("a").allowed).toBe(true);
    expect(limiter.attempt("a").allowed).toBe(false); // a is now locked

    vi.setSystemTime(2_000);
    expect(limiter.attempt("b").allowed).toBe(true);

    // Adding a third bucket should evict the oldest (a) while keeping b.
    vi.setSystemTime(3_000);
    expect(limiter.attempt("c").allowed).toBe(true);

    // a was evicted, so its counter reset and it is no longer locked.
    expect(limiter.attempt("a").allowed).toBe(true);
  });
});
