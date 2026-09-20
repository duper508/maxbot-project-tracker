import { describe, it, expect, beforeEach } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { resetDatabase, db } from "../db/index.js";
import { principals } from "../db/schema.js";
import { app } from "../server.js";
import { _setSetupTokenForTest, _clearSetupTokenForTest } from "../services/auth.js";
import { ipLimiter, accountLoginLimiter } from "../lib/rate-limit.js";

const TEST_OWNER_TOKEN = "legacy-owner-token-123";

describe("auth routes", () => {
  beforeEach(async () => {
    await resetDatabase(":memory:");
    await migrate(db, { migrationsFolder: "./migrations" });
    _clearSetupTokenForTest();
    config.OWNER_TOKEN = undefined;
    // Tests share the same in-memory limiters and the same client IP ("unknown").
    ipLimiter.reset("ip:unknown");
    accountLoginLimiter.reset("ip:unknown");
  });

  function extractCookie(setCookie: string | null): string {
    if (!setCookie) return "";
    const match = setCookie.match(/kanban_session=[^;]+/);
    return match ? match[0] : "";
  }

  async function setupOwner(): Promise<string> {
    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    const res = await post("/api/v1/setup", {
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });
    expect(res.status).toBe(200);
    return extractCookie(res.headers.get("set-cookie"));
  }

  async function post(path: string, body: unknown, headers?: Record<string, string>) {
    return app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost", ...headers },
      body: JSON.stringify(body),
    });
  }

  async function jsonBody(res: Response): Promise<any> {
    return res.json();
  }

  it("six activation cases: fresh setup", async () => {
    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    const res = await post("/api/v1/setup", {
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    expect(res.status).toBe(200);
    const json = await jsonBody(res);
    expect(json.principal.role).toBe("owner");

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("kanban_session=");
  });

  it("six activation cases: migrated with OWNER_TOKEN uses claim flow", async () => {
    config.OWNER_TOKEN = TEST_OWNER_TOKEN;
    const existingOwnerId = "00000000-0000-0000-0000-000000000001";
    await db.insert(principals).values({
      id: existingOwnerId,
      displayName: "Owner",
      kind: "human",
      role: "owner",
      createdAt: new Date(),
    });

    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    const setupRes = await post("/api/v1/setup", {
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });
    expect(setupRes.status).toBe(409);
    expect((await jsonBody(setupRes)).error.code).toBe("CLAIM_REQUIRED");

    const claimRes = await post("/api/v1/auth/claim", {
      setupToken: "0123456789abcdef0123456789abcdef",
      ownerToken: TEST_OWNER_TOKEN,
    });
    expect(claimRes.status).toBe(200);
    const { ticket } = await jsonBody(claimRes);

    const completeRes = await post("/api/v1/auth/claim/complete", {
      ticket,
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });
    expect(completeRes.status).toBe(200);
    const json = await jsonBody(completeRes);
    expect(json.principal.id).toBe(existingOwnerId);
  });

  it("six activation cases: migrated without OWNER_TOKEN adopts the owner row", async () => {
    const existingOwnerId = "00000000-0000-0000-0000-000000000001";
    await db.insert(principals).values({
      id: existingOwnerId,
      displayName: "Owner",
      kind: "human",
      role: "owner",
      createdAt: new Date(),
    });

    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    const res = await post("/api/v1/setup", {
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    expect(res.status).toBe(200);
    const json = await jsonBody(res);
    expect(json.principal.id).toBe(existingOwnerId);
  });

  it("six activation cases: claim-over-setup precedence blocks /setup", async () => {
    config.OWNER_TOKEN = TEST_OWNER_TOKEN;
    await db.insert(principals).values({
      id: "00000000-0000-0000-0000-000000000001",
      displayName: "Owner",
      kind: "human",
      role: "owner",
      createdAt: new Date(),
    });

    _setSetupTokenForTest("0123456789abcdef0123456789abcdef");
    const res = await post("/api/v1/setup", {
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    expect(res.status).toBe(409);
    const body = await jsonBody(res);
    expect(body.error.code).toBe("CLAIM_REQUIRED");

    const owner = await db.select().from(principals).where(eq(principals.role, "owner")).limit(1);
    expect(owner[0].passwordHash).toBeNull();
  });

  it("six activation cases: adoption ambiguity returns 500", async () => {
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
    const res = await post("/api/v1/setup", {
      setupToken: "0123456789abcdef0123456789abcdef",
      email: "owner@example.com",
      displayName: "Owner",
      password: "a-very-long-password",
    });

    expect(res.status).toBe(500);
    expect((await jsonBody(res)).error.code).toBe("ADOPTION_AMBIGUOUS");
  });

  it("login returns 401 for bad credentials", async () => {
    await setupOwner();

    const res = await post("/api/v1/auth/login", {
      email: "owner@example.com",
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
  });

  it("/auth/me requires authentication", async () => {
    await setupOwner();

    const res = await app.request("/api/v1/auth/me", {
      headers: { Origin: "http://localhost" },
    });
    expect(res.status).toBe(401);
  });

  it("change-password with current password invalidates the session", async () => {
    const cookie = await setupOwner();

    const changeRes = await post(
      "/api/v1/auth/change-password",
      {
        currentPassword: "a-very-long-password",
        newPassword: "another-very-long-password",
      },
      { Cookie: cookie, Origin: "http://localhost" },
    );
    expect(changeRes.status).toBe(200);

    const meRes = await app.request("/api/v1/auth/me", {
      headers: { Cookie: cookie, Origin: "http://localhost" },
    });
    expect(meRes.status).toBe(401);
  });
});
