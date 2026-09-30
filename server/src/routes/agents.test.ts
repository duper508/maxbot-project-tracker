import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { config } from "../config.js";
import { db, resetDatabase } from "../db/index.js";
import { app } from "../server.js";
import { _clearSetupTokenForTest, _setSetupTokenForTest } from "../services/auth.js";

interface AgentJson { id: string }
interface CreatedKeyJson {
  token: string;
  apiKey: { id: string; name: string; prefix: string };
}

describe("agent API key routes", () => {
  beforeEach(async () => {
    await resetDatabase(":memory:");
    await migrate(db, { migrationsFolder: "./migrations" });
    _clearSetupTokenForTest();
    config.OWNER_TOKEN = undefined;
  });

  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    return app.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
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
    return res.headers.get("set-cookie")!.match(/kanban_session=[^;]+/)![0];
  }

  it("returns a token only at creation and rejects it on the next request after revocation", async () => {
    const ownerCookie = await setupOwner();
    const agentRes = await post(
      "/api/v1/agents",
      { displayName: "Build Agent", kind: "codex", role: "editor" },
      { Cookie: ownerCookie },
    );
    expect(agentRes.status).toBe(201);
    const agent = await agentRes.json() as AgentJson;

    const createRes = await post(
      `/api/v1/agents/${agent.id}/keys`,
      { name: "primary" },
      { Cookie: ownerCookie },
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as CreatedKeyJson;
    expect(created.token).toMatch(/^bzk_[a-z2-7]{12}_[a-z2-7]{32}$/);
    expect(created.apiKey).toMatchObject({ name: "primary", prefix: expect.stringMatching(/^[a-z2-7]{12}$/) });

    const listRes = await app.request(`/api/v1/agents/${agent.id}/keys`, { headers: { Cookie: ownerCookie } });
    expect(listRes.status).toBe(200);
    const listed = await listRes.json() as unknown;
    expect(listed).toEqual([created.apiKey]);
    expect(JSON.stringify(listed)).not.toContain(created.token);

    const usableRes = await app.request("/api/v1/agents", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(usableRes.status).toBe(200);

    const revokeRes = await app.request(`/api/v1/agents/${agent.id}/keys/${created.apiKey.id}`, {
      method: "DELETE",
      headers: { Cookie: ownerCookie },
    });
    expect(revokeRes.status).toBe(204);

    const rejectedRes = await app.request("/api/v1/agents", {
      headers: { Authorization: `Bearer ${created.token}` },
    });
    expect(rejectedRes.status).toBe(401);
  });

  it("forbids editors from listing, minting, or revoking keys", async () => {
    const ownerCookie = await setupOwner();
    const agentRes = await post(
      "/api/v1/agents",
      { displayName: "Editor", kind: "human", role: "editor" },
      { Cookie: ownerCookie },
    );
    const editor = await agentRes.json() as AgentJson;
    const keyRes = await post(
      `/api/v1/agents/${editor.id}/keys`,
      { name: "editor-key" },
      { Cookie: ownerCookie },
    );
    const key = await keyRes.json() as CreatedKeyJson;

    const mintRes = await post(
      `/api/v1/agents/${editor.id}/keys`,
      { name: "another-key" },
      { Authorization: `Bearer ${key.token}` },
    );
    expect(mintRes.status).toBe(403);

    const listRes = await app.request(`/api/v1/agents/${editor.id}/keys`, {
      headers: { Authorization: `Bearer ${key.token}` },
    });
    expect(listRes.status).toBe(403);

    const revokeRes = await app.request(`/api/v1/agents/${editor.id}/keys/${key.apiKey.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${key.token}` },
    });
    expect(revokeRes.status).toBe(403);
  });
});
