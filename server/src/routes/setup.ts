import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { config } from "../config.js";
import { SESSION_COOKIE } from "../lib/auth.js";
import { ipLimiter, ipRateLimitKey } from "../lib/rate-limit.js";
import { setupInstance, login, _setSetupTokenForTest } from "../services/auth.js";
import { badRequest } from "../lib/errors.js";
import { errorSchema } from "./common.js";

const app = new OpenAPIHono();

const passwordSchema = z.string().min(12);
const emailSchema = z.string().email();

const setupRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Setup"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            setupToken: z.string().length(32),
            email: emailSchema,
            displayName: z.string().min(1),
            password: passwordSchema,
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Instance set up",
      content: {
        "application/json": {
          schema: z.object({
            principal: z.object({
              id: z.string().uuid(),
              displayName: z.string(),
              email: z.string().email(),
              role: z.enum(["owner", "editor", "viewer"]),
            }),
          }),
        },
      },
    },
    409: { description: "Claim required or setup conflict", content: { "application/json": { schema: errorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Invalid setup token", content: { "application/json": { schema: errorSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(setupRoute, async (c) => {
  const ipKey = ipRateLimitKey(c);
  const limit = ipLimiter.attempt(ipKey);
  if (!limit.allowed) {
    c.header("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
    return c.json({ error: { message: "Too many attempts. Try again later.", code: "RATE_LIMITED" } }, 429);
  }

  const body = c.req.valid("json");
  const principal = await setupInstance(body);
  const result = await login({ email: body.email, password: body.password });
  if (result.kind !== "session") {
    throw badRequest("Setup produced an unexpected state");
  }

  c.header("Set-Cookie", `${SESSION_COOKIE}=${result.jwt}; HttpOnly; Path=/; SameSite=Lax${config.NODE_ENV === "production" ? "; Secure" : ""}; Max-Age=${60 * 60 * 24 * 7}`);

  return c.json(
    {
      principal: {
        id: principal.id,
        displayName: principal.displayName,
        email: principal.email!,
        role: principal.role,
      },
    },
    200,
  );
});

// Test-only helper so the suite can inject a known token without scraping logs.
app.post("/_test/set-setup-token", async (c) => {
  if (config.NODE_ENV !== "test") {
    return c.json({ error: { message: "Not available outside test", code: "FORBIDDEN" } }, 403);
  }
  const { token, expiresAt } = await c.req.json();
  _setSetupTokenForTest(token, expiresAt);
  return c.json({ ok: true });
});

export default app;
