import { afterEach, describe, expect, it, vi } from "vitest";
import { login } from "./api";

describe("login", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts email and password credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
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
      )
    );
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
});
