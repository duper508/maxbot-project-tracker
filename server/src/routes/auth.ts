// @ts-nocheck
import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { setCookie, deleteCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { agents } from "../db/schema.js";
import { SESSION_COOKIE, signSession, verifyOwnerToken } from "../lib/auth.js";
import { unauthorized } from "../lib/errors.js";
import { errorSchema } from "./common.js";

const app = new OpenAPIHono();

const loginRoute = createRoute({
  method: "post",
  path: "/login",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ token: z.string() }),
        },
      },
    },
  },
  responses: {
    200: { description: "Logged in", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(loginRoute, async (c) => {
  const { token } = c.req.valid("json");
  if (!config.OWNER_TOKEN) {
    throw unauthorized("Owner token not configured");
  }
  if (!(await verifyOwnerToken(token))) {
    throw unauthorized("Invalid owner token");
  }

  // Find owner agent
  const rows = await db.select().from(agents).where(eq(agents.role, "owner")).limit(1);
  const owner = rows[0];
  if (!owner) throw unauthorized("No owner agent found");

  const jwt = await signSession({ agentId: owner.id, role: owner.role });
  setCookie(c, SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return c.json({ ok: true });
});

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
  return c.json({ ok: true });
});

export default app;
