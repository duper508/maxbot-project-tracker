import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { principals, settings, boards } from "../db/schema.js";
import type { Principal } from "../db/schema.js";
import { config } from "../config.js";
import { generateId, now } from "../lib/id.js";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
  signSession,
  signClaimTicket,
  verifyClaimTicket,
} from "../lib/auth.js";
import { KanbanError, badRequest, forbidden, unauthorized, notFound } from "../lib/errors.js";
import { DEFAULT_COLUMNS } from "./boards.js";

// ---------------------------------------------------------------------------
// Setup token: generated once per boot, printed to the log, verified by hash.
// ---------------------------------------------------------------------------

interface SetupTokenState {
  plaintext: string;
  hash: Buffer;
  expiresAt: number;
}

let setupTokenState: SetupTokenState | null = null;

export function initializeSetupToken(): string {
  const plaintext = randomBytes(16).toString("hex");
  setupTokenState = {
    plaintext,
    hash: createHash("sha256").update(plaintext).digest(),
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
  return plaintext;
}

export function getSetupTokenExpiry(): number | null {
  return setupTokenState?.expiresAt ?? null;
}

export function verifySetupToken(token: string): boolean {
  if (!setupTokenState) return false;
  if (setupTokenState.expiresAt <= Date.now()) return false;
  const hash = createHash("sha256").update(token).digest();
  return hash.length === setupTokenState.hash.length && timingSafeEqual(hash, setupTokenState.hash);
}

// Exposed for tests so they do not need to scrape logs.
export function _setSetupTokenForTest(token: string, expiresAt?: number): void {
  setupTokenState = {
    plaintext: token,
    hash: createHash("sha256").update(token).digest(),
    expiresAt: expiresAt ?? Date.now() + 60 * 60 * 1000,
  };
}

export function _clearSetupTokenForTest(): void {
  setupTokenState = null;
}

// ---------------------------------------------------------------------------
// Instance state: unclaimed and legacy-claim-live checks
// ---------------------------------------------------------------------------

export async function isInstanceUnclaimed(): Promise<boolean> {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(principals)
    .where(sql`${principals.passwordHash} IS NOT NULL AND ${principals.kind} = 'human'`);
  return rows[0].count === 0;
}

async function getLegacyClaimExpiry(): Promise<number | null> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "auth.legacyClaimExpiresAt"))
    .limit(1);
  const value = rows[0]?.value;
  return value ? Number(value) : null;
}

async function isLegacyTokenDisabled(): Promise<boolean> {
  const rows = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, "auth.legacyTokenDisabled"))
    .limit(1);
  return rows[0]?.value === "true";
}

export async function isLegacyClaimLive(): Promise<boolean> {
  if (!config.OWNER_TOKEN) return false;
  if (await isLegacyTokenDisabled()) return false;
  const expiresAt = await getLegacyClaimExpiry();
  if (!expiresAt) return false;
  return Date.now() < expiresAt;
}

export async function activeActivationPath(): Promise<"setup" | "claim"> {
  return (await isLegacyClaimLive()) ? "claim" : "setup";
}

// ---------------------------------------------------------------------------
// Legacy OWNER_TOKEN claim
// ---------------------------------------------------------------------------

function verifyLegacyOwnerToken(token: string): boolean {
  if (!config.OWNER_TOKEN) return false;
  const expected = Buffer.from(config.OWNER_TOKEN);
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export interface ClaimStartInput {
  setupToken: string;
  ownerToken: string;
}

export interface ClaimTicket {
  ticket: string;
  expiresAt: number;
}

export async function startClaim(input: ClaimStartInput): Promise<ClaimTicket> {
  if (!(await isLegacyClaimLive())) {
    throw forbidden("Legacy claim is not available");
  }
  if (!verifySetupToken(input.setupToken)) {
    throw unauthorized("Invalid or expired setup token");
  }
  if (!verifyLegacyOwnerToken(input.ownerToken)) {
    throw unauthorized("Invalid owner token");
  }

  // Find the unclaimed owner row to adopt.
  const ownerRows = await db
    .select()
    .from(principals)
    .where(eq(principals.role, "owner"))
    .limit(1);
  const owner = ownerRows[0];
  if (!owner) {
    throw badRequest("No owner row exists to claim");
  }

  return signClaimTicket(owner.id);
}

export interface ClaimCompleteInput {
  ticket: string;
  email: string;
  displayName: string;
  password: string;
}

export async function completeClaim(input: ClaimCompleteInput): Promise<Principal> {
  if (!(await isLegacyClaimLive())) {
    throw forbidden("Legacy claim is not available");
  }

  const ticketPayload = await verifyClaimTicket(input.ticket);

  const principalRows = await db
    .select()
    .from(principals)
    .where(eq(principals.id, ticketPayload.principalId))
    .limit(1);
  const principal = principalRows[0];
  if (!principal) throw notFound("Principal");

  await _changePrincipalPassword(principal.id, input.password);

  await db
    .update(principals)
    .set({
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      updatedAt: now(),
    })
    .where(eq(principals.id, principal.id));

  await db
    .insert(settings)
    .values({
      key: "auth.legacyTokenDisabled",
      value: "true",
      updatedAt: now(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: "true", updatedAt: now() },
    });

  return (await db.select().from(principals).where(eq(principals.id, principal.id)).limit(1))[0];
}

// ---------------------------------------------------------------------------
// First-run setup
// ---------------------------------------------------------------------------

export interface SetupInput {
  setupToken: string;
  email: string;
  displayName: string;
  password: string;
}

export async function setupInstance(input: SetupInput): Promise<Principal> {
  if (!verifySetupToken(input.setupToken)) {
    throw unauthorized("Invalid or expired setup token");
  }

  if (await isLegacyClaimLive()) {
    throw new KanbanError(
      "This instance must be claimed through the legacy claim flow",
      409,
      "CLAIM_REQUIRED",
    );
  }

  if (!(await isInstanceUnclaimed())) {
    throw forbidden("Instance is already set up");
  }

  const passwordCheck = validatePassword(input.password);
  if (!passwordCheck.ok) throw badRequest(passwordCheck.reason);

  // Adoption logic: preserve the existing owner row's id when possible.
  const nullHashHumans = await db
    .select()
    .from(principals)
    .where(sql`${principals.passwordHash} IS NULL AND ${principals.kind} = 'human'`);

  let ownerId: string;
  const timestamp = now();

  if (nullHashHumans.length === 0) {
    ownerId = generateId();
    await db.insert(principals).values({
      id: ownerId,
      displayName: input.displayName,
      kind: "human",
      email: input.email.toLowerCase(),
      passwordHash: hashPassword(input.password),
      role: "owner",
      status: "active",
      passwordChangedAt: timestamp,
      mustChangePassword: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } else if (nullHashHumans.length === 1) {
    ownerId = nullHashHumans[0].id;
    await db
      .update(principals)
      .set({
        displayName: input.displayName,
        email: input.email.toLowerCase(),
        passwordHash: hashPassword(input.password),
        passwordChangedAt: timestamp,
        mustChangePassword: false,
        updatedAt: timestamp,
      })
      .where(eq(principals.id, ownerId));
  } else {
    const ids = nullHashHumans.map((p) => p.id).join(", ");
    console.error(`ADOPTION_AMBIGUOUS: ${nullHashHumans.length} null-hash human principals: ${ids}`);
    throw new (await import("../lib/errors.js")).KanbanError(
      "Cannot adopt owner row: multiple candidates found",
      500,
      "ADOPTION_AMBIGUOUS",
    );
  }

  // Ensure a default board exists.
  const boardRows = await db.select({ count: sql<number>`count(*)` }).from(boards);
  if (boardRows[0].count === 0) {
    await db.insert(boards).values({
      id: generateId(),
      name: "Main Board",
      slug: "main",
      columns: DEFAULT_COLUMNS,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: ownerId,
    });
  }

  return (await db.select().from(principals).where(eq(principals.id, ownerId)).limit(1))[0];
}

// ---------------------------------------------------------------------------
// Login / logout / me / change password
// ---------------------------------------------------------------------------

export interface LoginInput {
  email: string;
  password: string;
}

export type LoginResult =
  | { kind: "session"; principal: Principal; jwt: string }
  | { kind: "must-change-password"; principalId: string; ticket: string; expiresAt: number };

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export async function login(input: LoginInput): Promise<LoginResult> {
  const email = input.email.toLowerCase();
  const principalRows = await db
    .select()
    .from(principals)
    .where(eq(principals.email, email))
    .limit(1);
  const principal = principalRows[0];

  if (!principal) {
    // Run a dummy hash to keep timing roughly constant.
    verifyPassword(input.password, "$2a$12$abcdefghijklmnopqrstuvwxyc2hvk0v0");
    throw unauthorized("Invalid email or password");
  }

  if (principal.status !== "active") {
    throw unauthorized("Account disabled");
  }

  if (principal.lockedUntil && principal.lockedUntil.getTime() > Date.now()) {
    throw unauthorized("Account locked. Try again later.");
  }

  if (!verifyPassword(input.password, principal.passwordHash ?? "")) {
    const timestamp = now();
    const failedCount = (principal.failedLoginCount ?? 0) + 1;
    const lockedUntil =
      failedCount >= MAX_FAILED_LOGINS
        ? new Date(timestamp.getTime() + LOCKOUT_MINUTES * 60_000)
        : principal.lockedUntil;
    await db
      .update(principals)
      .set({
        failedLoginCount: failedCount,
        lockedUntil,
        updatedAt: timestamp,
      })
      .where(eq(principals.id, principal.id));
    throw unauthorized("Invalid email or password");
  }

  const timestamp = now();
  const passwordChangedAt = principal.passwordChangedAt ?? timestamp;
  const pwv = passwordChangedAt.getTime();

  await db
    .update(principals)
    .set({
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: timestamp,
      passwordChangedAt,
      updatedAt: timestamp,
    })
    .where(eq(principals.id, principal.id));

  if (principal.mustChangePassword) {
    const { ticket, expiresAt } = await signClaimTicket(principal.id);
    return { kind: "must-change-password", principalId: principal.id, ticket, expiresAt };
  }

  const jwt = await signSession({ principalId: principal.id, pwv });
  return { kind: "session", principal: { ...principal, passwordChangedAt }, jwt };
}

export interface ChangePasswordInput {
  principalId: string;
  currentPassword?: string;
  newPassword: string;
  ticket?: string;
}

export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const passwordCheck = validatePassword(input.newPassword);
  if (!passwordCheck.ok) throw badRequest(passwordCheck.reason);

  let principalId = input.principalId;

  if (input.ticket) {
    const ticketPayload = await verifyClaimTicket(input.ticket);
    principalId = ticketPayload.principalId;
  }

  const principalRows = await db
    .select()
    .from(principals)
    .where(eq(principals.id, principalId))
    .limit(1);
  const principal = principalRows[0];
  if (!principal) throw notFound("Principal");

  if (!input.ticket) {
    if (!input.currentPassword || !verifyPassword(input.currentPassword, principal.passwordHash ?? "")) {
      throw unauthorized("Current password is incorrect");
    }
  }

  await _changePrincipalPassword(principal.id, input.newPassword);
}

async function _changePrincipalPassword(principalId: string, newPassword: string): Promise<void> {
  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.ok) throw badRequest(passwordCheck.reason);

  const timestamp = now();
  await db
    .update(principals)
    .set({
      passwordHash: hashPassword(newPassword),
      passwordChangedAt: timestamp,
      mustChangePassword: false,
      updatedAt: timestamp,
    })
    .where(eq(principals.id, principalId));
}

export async function getPrincipalMe(principalId: string): Promise<Principal> {
  const rows = await db.select().from(principals).where(eq(principals.id, principalId)).limit(1);
  const principal = rows[0];
  if (!principal) throw notFound("Principal");
  return principal;
}
