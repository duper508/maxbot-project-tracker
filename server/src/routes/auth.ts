import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { config } from "../config.js";
import { SESSION_COOKIE, authMiddleware } from "../lib/auth.js";
import { ipLimiter, accountLoginLimiter, ipRateLimitKey } from "../lib/rate-limit.js";
import {
  startClaim,
  completeClaim,
  login,
  changePassword,
  getPrincipalMe,
} from "../services/auth.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { errorSchema } from "./common.js";
import type { Principal } from "../db/schema.js";

const app = new OpenAPIHono<{ Variables: { principal: Principal } }>();

function setSessionCookie(c: any, jwt: string): void {
  setCookie(c, SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

const passwordSchema = z.string().min(12);
const emailSchema = z.string().email();

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// ---------------------------------------------------------------------------

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            email: emailSchema,
            password: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Logged in or password-change ticket issued",
      content: {
        "application/json": {
          schema: z.object({
            principal: z.object({
              id: z.string().uuid(),
              displayName: z.string(),
              email: z.string().email(),
              role: z.enum(["owner", "editor", "viewer"]),
              mustChangePassword: z.boolean(),
            }),
            ticket: z.string().optional(),
            ticketExpiresAt: z.number().optional(),
          }),
        },
      },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(loginRoute, async (c) => {
  const body = c.req.valid("json");
  const ipKey = ipRateLimitKey(c);
  const accountKey = `${ipKey}:email:${body.email.toLowerCase()}`;

  const ipLimit = ipLimiter.attempt(ipKey);
  if (!ipLimit.allowed) {
    c.header("Retry-After", String(Math.ceil(ipLimit.retryAfterMs / 1000)));
    return c.json({ error: { message: "Too many attempts. Try again later.", code: "RATE_LIMITED" } }, 429);
  }

  const accountLimit = accountLoginLimiter.attempt(accountKey);
  if (!accountLimit.allowed) {
    c.header("Retry-After", String(Math.ceil(accountLimit.retryAfterMs / 1000)));
    return c.json({ error: { message: "Too many attempts. Try again later.", code: "RATE_LIMITED" } }, 429);
  }

  try {
    const result = await login(body);

    if (result.kind === "must-change-password") {
      accountLoginLimiter.reset(accountKey);
      return c.json(
        {
          principal: {
            id: result.principalId,
            displayName: "",
            email: body.email,
            role: "owner" as const,
            mustChangePassword: true,
          },
          ticket: result.ticket,
          ticketExpiresAt: result.expiresAt,
        },
        200,
      );
    }

    accountLoginLimiter.reset(accountKey);
    setSessionCookie(c, result.jwt);
    return c.json(
      {
        principal: {
          id: result.principal.id,
          displayName: result.principal.displayName,
          email: result.principal.email!,
          role: result.principal.role,
          mustChangePassword: false,
        },
      },
      200,
    );
  } catch (err) {
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout
// ---------------------------------------------------------------------------

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  tags: ["Auth"],
  responses: {
    200: { description: "Logged out", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
  },
});

app.openapi(logoutRoute, (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true }, 200);
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------

const meRoute = createRoute({
  method: "get",
  path: "/me",
  tags: ["Auth"],
  responses: {
    200: {
      description: "Current principal",
      content: {
        "application/json": {
          schema: z.object({
            principal: z.object({
              id: z.string().uuid(),
              displayName: z.string(),
              email: z.string().email().nullable(),
              role: z.enum(["owner", "editor", "viewer"]),
              kind: z.enum(["buzz", "openclaw", "claude", "codex", "manual", "human"]),
              status: z.enum(["active", "disabled"]),
              mustChangePassword: z.boolean(),
            }),
          }),
        },
      },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.use("/me", authMiddleware);
app.openapi(meRoute, async (c) => {
  const principal = c.get("principal");
  const me = await getPrincipalMe(principal.id);
  return c.json(
    {
      principal: {
        id: me.id,
        displayName: me.displayName,
        email: me.email,
        role: me.role,
        kind: me.kind,
        status: me.status,
        mustChangePassword: me.mustChangePassword,
      },
    },
    200,
  );
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/change-password
// ---------------------------------------------------------------------------

const changePasswordRoute = createRoute({
  method: "post",
  path: "/change-password",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            currentPassword: z.string().optional(),
            newPassword: passwordSchema,
            ticket: z.string().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Password changed", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(changePasswordRoute, async (c) => {
  const body = c.req.valid("json");
  if (!body.ticket && !body.currentPassword) {
    throw badRequest("Either currentPassword or ticket is required");
  }

  let principalId: string | undefined;
  if (!body.ticket) {
    // Voluntary change: require an authenticated session.
    const { loadAuthenticatedPrincipal } = await import("../lib/auth.js");
    const token = getCookie(c, SESSION_COOKIE);
    const principal = await loadAuthenticatedPrincipal(c.req.header("Authorization"), token);
    if (!principal) throw unauthorized();
    principalId = principal.id;
  }

  await changePassword({
    principalId: principalId ?? "",
    currentPassword: body.currentPassword,
    newPassword: body.newPassword,
    ticket: body.ticket,
  });

  // If a session cookie was present, clear it so the caller must log in again.
  if (!body.ticket) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
  }

  return c.json({ ok: true }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/claim
// ---------------------------------------------------------------------------

const claimRoute = createRoute({
  method: "post",
  path: "/claim",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            setupToken: z.string().length(32),
            ownerToken: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Claim ticket issued",
      content: {
        "application/json": {
          schema: z.object({ ticket: z.string(), ticketExpiresAt: z.number() }),
        },
      },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
    410: { description: "Claim expired", content: { "application/json": { schema: errorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(claimRoute, async (c) => {
  const ipKey = ipRateLimitKey(c);
  const limit = ipLimiter.attempt(ipKey);
  if (!limit.allowed) {
    c.header("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
    return c.json({ error: { message: "Too many attempts. Try again later.", code: "RATE_LIMITED" } }, 429);
  }

  const body = c.req.valid("json");
  const ticket = await startClaim(body);
  return c.json({ ticket: ticket.ticket, ticketExpiresAt: ticket.expiresAt }, 200);
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/claim/complete
// ---------------------------------------------------------------------------

const claimCompleteRoute = createRoute({
  method: "post",
  path: "/claim/complete",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            ticket: z.string().min(1),
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
      description: "Claim completed",
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
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
    429: { description: "Rate limited", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(claimCompleteRoute, async (c) => {
  const ipKey = ipRateLimitKey(c);
  const limit = ipLimiter.attempt(ipKey);
  if (!limit.allowed) {
    c.header("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000)));
    return c.json({ error: { message: "Too many attempts. Try again later.", code: "RATE_LIMITED" } }, 429);
  }

  const body = c.req.valid("json");
  const principal = await completeClaim(body);
  const result = await login({ email: body.email, password: body.password });
  if (result.kind !== "session") {
    throw badRequest("Claim completion produced an unexpected state");
  }
  setSessionCookie(c, result.jwt);
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

export default app;
