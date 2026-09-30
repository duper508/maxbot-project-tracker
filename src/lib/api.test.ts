import { afterEach, describe, expect, it, vi } from "vitest";
import { completePasswordChange, login } from "./api";

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
