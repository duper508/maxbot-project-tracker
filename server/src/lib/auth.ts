import { createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { apiKeys, principals } from "../db/schema.js";
import type { Principal } from "../db/schema.js";
import { forbidden, unauthorized } from "./errors.js";

export const SESSION_COOKIE = "kanban_session";

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

export interface SessionPayload {
  principalId: string;
  pwv: number;
}

// ---------------------------------------------------------------------------
// Key derivation from APP_SECRET
// ---------------------------------------------------------------------------

export function deriveSessionKey(): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", Buffer.from(config.APP_SECRET, "hex"), "", "kanban/session-v1", 32));
}

export function deriveDataKey(): Uint8Array {
  return new Uint8Array(hkdfSync("sha256", Buffer.from(config.APP_SECRET, "hex"), "", "kanban/settings-v1", 32));
}

function secretBytes(): Uint8Array {
  // Lazily derived so tests can swap config without importing order mattering.
  return deriveSessionKey();
}

// ---------------------------------------------------------------------------
// Base32 encoding / decoding (RFC 4648, lowercase, no padding)
// ---------------------------------------------------------------------------

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const map = new Map<string, number>();
  for (let i = 0; i < BASE32_ALPHABET.length; i++) {
    map.set(BASE32_ALPHABET[i], i);
  }
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.toLowerCase()) {
    const v = map.get(ch);
    if (v === undefined) throw new Error("Invalid base32 character");
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 12);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

const COMMON_PASSWORDS = new Set([
  "password",
  "password123",
  "password123456",
  "123456",
  "123456789",
  "12345678",
  "12345",
  "qwerty",
  "abc123",
  "letmein",
  "welcome",
  "admin",
  "root",
]);

export function validatePassword(password: string): { ok: true } | { ok: false; reason: string } {
  if (password.length < 12) return { ok: false, reason: "Password must be at least 12 characters" };
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: "Password is too common" };
  }
  if (/^\d+$/.test(password)) {
    return { ok: false, reason: "Password cannot be digits only" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// API keys: prefix-addressable, SHA-256 at rest, constant-time compare
// ---------------------------------------------------------------------------

export interface GeneratedApiKey {
  fullKey: string;
  prefix: string;
  secret: string;
  keyHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const keyId = randomBytes(8); // 64 bits -> 13 base32 chars, truncated to 12
  const secret = randomBytes(20); // 160 bits -> 32 base32 chars
  const keyIdStr = base32Encode(keyId).slice(0, 12);
  const secretStr = base32Encode(secret);
  const fullKey = `bzk_${keyIdStr}_${secretStr}`;
  const keyHash = hashApiKeySecret(secretStr);
  return { fullKey, prefix: keyIdStr, secret: secretStr, keyHash };
}

export function hashApiKeySecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function parseApiKey(fullKey: string): { prefix: string; secret: string } | null {
  const parts = fullKey.split("_");
  if (parts.length !== 3 || parts[0] !== "bzk") return null;
  const [_, prefix, secret] = parts;
  if (!prefix || !secret || prefix.length !== 12 || secret.length !== 32) return null;
  return { prefix, secret };
}

export function constantTimeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison of equal-length buffers to avoid leaking the length.
    timingSafeEqual(Buffer.alloc(bufA.length), bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export async function resolvePrincipalByApiKey(fullKey: string): Promise<Principal | null> {
  const parsed = parseApiKey(fullKey);
  if (!parsed) return null;

  const keyRows = await db.select().from(apiKeys).where(eq(apiKeys.prefix, parsed.prefix)).limit(1);
  const keyRow = keyRows[0];
  if (!keyRow) return null;
  if (keyRow.revokedAt) return null;
  if (keyRow.expiresAt && keyRow.expiresAt.getTime() <= Date.now()) return null;

  const expectedHash = hashApiKeySecret(parsed.secret);
  if (!constantTimeCompare(expectedHash, keyRow.keyHash)) return null;

  const principalRows = await db
    .select()
    .from(principals)
    .where(eq(principals.id, keyRow.principalId))
    .limit(1);
  return principalRows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretBytes());
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secretBytes(), {
    algorithms: ["HS256"],
  });
  return {
    principalId: String(payload.principalId),
    pwv: Number(payload.pwv),
  };
}

export interface ClaimTicketPayload {
  scope: "claim";
  principalId: string;
}

export async function signClaimTicket(principalId: string): Promise<{ ticket: string; expiresAt: number }> {
  const expiresAt = Date.now() + 10 * 60 * 1000;
  const ticket = await new SignJWT({ scope: "claim", principalId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt / 1000))
    .sign(secretBytes());
  return { ticket, expiresAt };
}

export async function verifyClaimTicket(token: string): Promise<ClaimTicketPayload> {
  const { payload } = await jwtVerify(token, secretBytes(), {
    algorithms: ["HS256"],
  });
  if (payload.scope !== "claim") {
    throw new Error("Invalid claim ticket scope");
  }
  return {
    scope: "claim",
    principalId: String(payload.principalId),
  };
}

export async function resolvePrincipalById(id: string): Promise<Principal | null> {
  const rows = await db.select().from(principals).where(eq(principals.id, id)).limit(1);
  return rows[0] ?? null;
}

export function requireRole(principal: Principal, allowed: Principal["role"][]) {
  if (!allowed.includes(principal.role)) {
    throw forbidden();
  }
}

export async function loadAuthenticatedPrincipal(
  authHeader: string | undefined,
  cookieValue: string | undefined,
): Promise<Principal | null> {
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7);
    return resolvePrincipalByApiKey(key);
  }

  if (cookieValue) {
    try {
      const session = await verifySession(cookieValue);
      const principal = await resolvePrincipalById(session.principalId);
      if (!principal) return null;
      // Reject sessions issued before the password was last changed.
      const pwv = principal.passwordChangedAt?.getTime() ?? 0;
      if (session.pwv !== pwv) return null;
      return principal;
    } catch {
      return null;
    }
  }

  return null;
}

export const authMiddleware = createMiddleware<{
  Variables: { principal: Principal };
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = getCookie(c, SESSION_COOKIE);
  const principal = await loadAuthenticatedPrincipal(authHeader, token);
  if (!principal) {
    if (token) deleteCookie(c, SESSION_COOKIE);
    throw unauthorized("Invalid or expired session");
  }
  if (principal.status !== "active") {
    throw unauthorized("Account disabled");
  }
  c.set("principal", principal);
  return next();
});

export const optionalAuthMiddleware = createMiddleware<{
  Variables: { principal: Principal | null };
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const token = getCookie(c, SESSION_COOKIE);
  const principal = await loadAuthenticatedPrincipal(authHeader, token);
  if (principal && principal.status !== "active") {
    c.set("principal", null);
  } else {
    c.set("principal", principal);
  }
  return next();
});
