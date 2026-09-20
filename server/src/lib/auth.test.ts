import { describe, it, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import {
  deriveSessionKey,
  deriveDataKey,
  hashPassword,
  verifyPassword,
  validatePassword,
  generateApiKey,
  parseApiKey,
  hashApiKeySecret,
  constantTimeCompare,
  base32Encode,
  base32Decode,
  signSession,
  verifySession,
  signClaimTicket,
  verifyClaimTicket,
  resolvePrincipalByApiKey,
} from "./auth.js";
import { resetDatabase, db } from "../db/index.js";
import { principals, apiKeys } from "../db/schema.js";
import { generateId, now } from "./id.js";

describe("auth crypto", () => {
  it("derives two different subkeys from APP_SECRET", () => {
    const sessionKey = deriveSessionKey();
    const dataKey = deriveDataKey();
    expect(sessionKey).toHaveLength(32);
    expect(dataKey).toHaveLength(32);
    expect(Buffer.from(sessionKey).toString("hex")).not.toBe(Buffer.from(dataKey).toString("hex"));
  });

  it("hashes and verifies passwords with bcrypt", () => {
    const hash = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("correct-horse-battery-staple", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("rejects passwords that are too short or too common", () => {
    expect(validatePassword("short").ok).toBe(false);
    expect(validatePassword("123456789012").ok).toBe(false);
    expect(validatePassword("password123456").ok).toBe(false);
    expect(validatePassword("a-very-long-uncommon-password").ok).toBe(true);
  });

  it("generates and parses API keys", () => {
    const generated = generateApiKey();
    expect(generated.fullKey).toMatch(/^bzk_[a-z2-7]{12}_[a-z2-7]{32}$/);
    const parsed = parseApiKey(generated.fullKey);
    expect(parsed).not.toBeNull();
    expect(parsed?.prefix).toBe(generated.prefix);
    expect(parsed?.secret).toBe(generated.secret);
    expect(parseApiKey("not-a-key")).toBeNull();
  });

  it("hashes API key secrets deterministically with SHA-256", () => {
    const h1 = hashApiKeySecret("secretvalue");
    const h2 = hashApiKeySecret("secretvalue");
    const h3 = hashApiKeySecret("differentvalue");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
    expect(h1).toHaveLength(64);
  });

  it("compares strings in constant time", () => {
    expect(constantTimeCompare("abc", "abc")).toBe(true);
    expect(constantTimeCompare("abc", "abC")).toBe(false);
    expect(constantTimeCompare("abc", "abcd")).toBe(false);
  });

  it("round-trips base32", () => {
    const data = Buffer.from("hello world");
    const encoded = base32Encode(data);
    const decoded = base32Decode(encoded);
    expect(decoded.toString()).toBe("hello world");
  });
});

describe("auth sessions", () => {
  it("signs and verifies session JWTs carrying pwv", async () => {
    const jwt = await signSession({ principalId: "principal-id", pwv: 123456 });
    const payload = await verifySession(jwt);
    expect(payload.principalId).toBe("principal-id");
    expect(payload.pwv).toBe(123456);
  });

  it("signs and verifies claim tickets", async () => {
    const { ticket } = await signClaimTicket("principal-id");
    const payload = await verifyClaimTicket(ticket);
    expect(payload.scope).toBe("claim");
    expect(payload.principalId).toBe("principal-id");
  });
});

describe("auth database resolution", () => {
  beforeAll(async () => {
    await resetDatabase(":memory:");
    await migrate(db, { migrationsFolder: "./migrations" });
  });

  it("resolves a principal by a valid API key", async () => {
    const principalId = generateId();
    await db.insert(principals).values({
      id: principalId,
      displayName: "Test Agent",
      kind: "openclaw",
      role: "editor",
      createdAt: now(),
    });

    const generated = generateApiKey();
    await db.insert(apiKeys).values({
      id: generateId(),
      principalId,
      name: "default",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      createdBy: principalId,
      createdAt: now(),
    });

    const resolved = await resolvePrincipalByApiKey(generated.fullKey);
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe(principalId);
  });

  it("rejects an API key with a mismatched secret", async () => {
    const generated = generateApiKey();
    const resolved = await resolvePrincipalByApiKey(generated.fullKey.replace(/.$/, "x"));
    expect(resolved).toBeNull();
  });

  it("rejects a revoked API key", async () => {
    const principalId = generateId();
    await db.insert(principals).values({
      id: principalId,
      displayName: "Revoked Agent",
      kind: "openclaw",
      role: "editor",
      createdAt: now(),
    });

    const generated = generateApiKey();
    await db.insert(apiKeys).values({
      id: generateId(),
      principalId,
      name: "default",
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      createdBy: principalId,
      createdAt: now(),
      revokedAt: now(),
    });

    const resolved = await resolvePrincipalByApiKey(generated.fullKey);
    expect(resolved).toBeNull();
  });
});
