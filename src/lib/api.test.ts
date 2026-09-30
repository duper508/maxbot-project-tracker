import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completePasswordChange,
  createAgentApiKey,
  listAgentApiKeys,
  login,
  revokeAgentApiKey,
} from "./api";

function sessionResponse() {
  return new Response(
    JSON.stringify({
      principal: {
        id: "00000000-0000-0000-0000-000000000001",
        displayName: "Owner",
        email: "owner@example.com",
        role: "owner",
        mustChangePassword: false,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("login", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts email and password credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sessionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await login({ email: "owner@example.com", password: "correct horse battery" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          password: "correct horse battery",
        }),
      })
    );
    expect(fetchMock.mock.calls[0][1].body).not.toContain("token");
  });

  it("returns password-change tickets instead of treating them as sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          principal: {
            id: "00000000-0000-0000-0000-000000000001",
            displayName: "",
            email: "owner@example.com",
            role: "owner",
            mustChangePassword: true,
          },
          ticket: "ticket-123",
          ticketExpiresAt: 1790758000000,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await login({
      email: "owner@example.com",
      password: "temporary-password",
    });

    expect(result).toEqual({
      kind: "must-change-password",
      principal: {
        id: "00000000-0000-0000-0000-000000000001",
        displayName: "",
        email: "owner@example.com",
        role: "owner",
        mustChangePassword: true,
      },
      ticket: "ticket-123",
      ticketExpiresAt: 1790758000000,
    });
  });

  it("completes a password-change ticket and signs in with the new password", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(sessionResponse());
    vi.stubGlobal("fetch", fetchMock);

    await completePasswordChange(
      "ticket-123",
      "owner@example.com",
      "new-password-123"
    );

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/change-password",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          ticket: "ticket-123",
          newPassword: "new-password-123",
        }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "owner@example.com",
          password: "new-password-123",
        }),
      })
    );
  });
});

describe("agent API keys", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists key metadata without a token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "11111111-1111-1111-1111-111111111111",
            name: "Production",
            prefix: "abc123def456",
            createdAt: 1790758000000,
            lastUsedAt: 1790759000000,
          },
        ]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const keys = await listAgentApiKeys("agent-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agents/agent-1/keys",
      expect.objectContaining({ credentials: "include" })
    );
    expect(keys).toEqual([
      {
        id: "11111111-1111-1111-1111-111111111111",
        name: "Production",
        prefix: "abc123def456",
        createdAt: 1790758000000,
        lastUsedAt: 1790759000000,
      },
    ]);
    expect(JSON.stringify(keys)).not.toContain("bzk_");
  });

  it("creates a key and returns the one-time token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          apiKey: {
            id: "11111111-1111-1111-1111-111111111111",
            name: "Production",
            prefix: "abc123def456",
            createdAt: 1790758000000,
          },
          token: "bzk_abc123def456_secret",
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = await createAgentApiKey("agent-1", "Production");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agents/agent-1/keys",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Production" }),
      })
    );
    expect(created.token).toBe("bzk_abc123def456_secret");
    expect(created.apiKey).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Production",
      prefix: "abc123def456",
      createdAt: 1790758000000,
    });
  });

  it("revokes a key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeAgentApiKey("agent-1", "key-1");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/agents/agent-1/keys/key-1",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
