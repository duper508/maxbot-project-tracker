import { describe, it, expect, beforeEach } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { resetDatabase, db } from "../db/index.js";
import { principals, settings, boards } from "../db/schema.js";
import {
  _setSetupTokenForTest,
  _clearSetupTokenForTest,
  isInstanceUnclaimed,
  isLegacyClaimLive,
  setupInstance,
  startClaim,
  completeClaim,
  login,
  changePassword,
} from "./auth.js";
import { verifySession, loadAuthenticatedPrincipal } from "../lib/auth.js";

const TEST_OWNER_TOKEN = "legacy-owner-token-123";

describe("auth service", () => {
  beforeEach(async () => {
    await resetDatabase(":memory:");
    await migrate(db, { migrationsFolder: "./migrations" });
    _clearSetupTokenForTest();
    config.OWNER_TOKEN = undefined;
  });

  it("fresh setup creates an owner and default board", async () => {
    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    const principal = await setupInstance({
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    expect(principal.role).toBe("owner");
    expect(principal.email).toBe("owner@example.com");
    expect(await isInstanceUnclaimed()).toBe(false);

    const boardRows = await db.select().from(boards);
    expect(boardRows.length).toBe(1);
    expect(boardRows[0].name).toBe("Main Board");
  });

  it("setup rejects an invalid setup token", async () => {
    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    await expect(
      setupInstance({
        setupToken: "wrong-token-1234567890123456",
        email: "owner@example.com",
        displayName: "Owner",
        password: "a-very-long-password",
      }),
    ).rejects.toThrow("Invalid or expired setup token");
  });

  it("setup rejects an expired setup token", async () => {
    _setSetupTokenForTest("0123456789abcdef0123456789abcdef", Date.now() - 1000);
    await expect(
      setupInstance({
        setupToken: "0123456789abcdef0123456789abcdef",
        email: "owner@example.com",
        displayName: "Owner",
        password: "a-very-long-password",
      }),
    ).rejects.toThrow("Invalid or expired setup token");
  });

  it("setup adopts the existing unclaimed owner row preserving its id", async () => {
    const existingOwnerId = "00000000-0000-0000-0000-000000000001";
    await db.insert(principals).values({
      id: existingOwnerId,
      displayName: "Owner",
      kind: "human",
      role: "owner",
      createdAt: new Date(),
    });

    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    const principal = await setupInstance({
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Updated Owner",
      password: "a-very-long-password",
    });

    expect(principal.id).toBe(existingOwnerId);
    expect(principal.displayName).toBe("Updated Owner");
  });

  it("setup fails closed when multiple null-hash human principals exist", async () => {
    await db.insert(principals).values({
      id: "00000000-0000-0000-0000-000000000001",
      displayName: "Owner One",
      kind: "human",
      role: "owner",
      createdAt: new Date(),
    });
    await db.insert(principals).values({
      id: "00000000-0000-0000-0000-000000000002",
      displayName: "Owner Two",
      kind: "human",
      role: "owner",
      createdAt: new Date(),
    });

    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    await expect(
      setupInstance({
        setupToken: "0123456789abcdef0123456789abcdef",
        email: "owner@example.com",
        displayName: "Owner",
        password: "a-very-long-password",
      }),
    ).rejects.toMatchObject({ status: 500, code: "ADOPTION_AMBIGUOUS" });
  });

  it("claim path is live when OWNER_TOKEN is set and not disabled", async () => {
    config.OWNER_TOKEN = TEST_OWNER_TOKEN;
    expect(await isLegacyClaimLive()).toBe(true);
    config.OWNER_TOKEN = undefined;
  });

  it("claim path is not live when OWNER_TOKEN is absent", async () => {
    config.OWNER_TOKEN = undefined;
    expect(await isLegacyClaimLive()).toBe(false);
  });

  it("claim path issues a scoped ticket and completes", async () => {
    config.OWNER_TOKEN = TEST_OWNER_TOKEN;
    await db.insert(principals).values({
      id: "00000000-0000-0000-0000-000000000001",
      displayName: "Owner",
      kind: "human",
      role: "owner",
      createdAt: new Date(),
    });

    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    const ticket = await startClaim({
      setupToken: "0123456789abcdef0123456789abcdef",
      ownerToken: TEST_OWNER_TOKEN,
    });
    expect(ticket.ticket).toBeTruthy();

    const principal = await completeClaim({
      ticket: ticket.ticket,
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    expect(principal.email).toBe("owner@example.com");
    expect(await isLegacyClaimLive()).toBe(false);

    const disabled = await db
      .select()
      .from(settings)
      .where(eq(settings.key, "auth.legacyTokenDisabled"));
    expect(disabled[0]?.value).toBe("true");

    config.OWNER_TOKEN = undefined;
  });

  it("setup returns 409 CLAIM_REQUIRED while claim path is live", async () => {
    config.OWNER_TOKEN = TEST_OWNER_TOKEN;
    await db.insert(principals).values({
      id: "00000000-0000-0000-0000-000000000001",
      displayName: "Owner",
      kind: "human",
      role: "owner",
      createdAt: new Date(),
    });

    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    await expect(
      setupInstance({
        setupToken: "0123456789abcdef0123456789abcdef",
        email: "owner@example.com",
        displayName: "Owner",
        password: "a-very-long-password",
      }),
    ).rejects.toMatchObject({ status: 409, code: "CLAIM_REQUIRED" });

    config.OWNER_TOKEN = undefined;
  });

  it("login issues a session for valid credentials", async () => {
    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    await setupInstance({
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    const result = await login({ email: "owner@example.com", password: "a-very-long-password" });
    expect(result.kind).toBe("session");
    if (result.kind === "session") {
      const payload = await verifySession(result.jwt);
      expect(payload.principalId).toBe(result.principal.id);
    }
  });

  it("login returns a ticket when mustChangePassword is set", async () => {
    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    await setupInstance({
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    await db
      .update(principals)
      .set({ mustChangePassword: true })
      .where(eq(principals.email, "owner@example.com"));

    const result = await login({ email: "owner@example.com", password: "a-very-long-password" });
    expect(result.kind).toBe("must-change-password");
  });

  it("login uses a generic error for unknown emails", async () => {
    await expect(login({ email: "nobody@example.com", password: "any-password" })).rejects.toThrow(
      "Invalid email or password",
    );
  });

  it("password change invalidates existing sessions", async () => {
    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    await setupInstance({
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    const before = await login({ email: "owner@example.com", password: "a-very-long-password" });
    expect(before.kind).toBe("session");
    if (before.kind !== "session") throw new Error("unexpected");

    await changePassword({
      principalId: before.principal.id,
      currentPassword: "a-very-long-password",
      newPassword: "another-very-long-password",
    });

    const reloaded = await loadAuthenticatedPrincipal(undefined, before.jwt);
    expect(reloaded).toBeNull();
  });
});
