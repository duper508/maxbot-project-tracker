import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie } from "hono/cookie";
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { agents, apiKeys } from "../db/schema.js";
import type { Agent } from "../db/schema.js";
import { forbidden, unauthorized } from "./errors.js";

export const SESSION_COOKIE = "kanban_session";

export interface SessionPayload {
  agentId: string;
  role: Agent["role"];
}

const secretBytes = new TextEncoder().encode(config.SESSION_SECRET);

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function hashApiKey(key: string): string {
  return bcrypt.hashSync(key, 10);
}

export function verifyApiKey(key: string, hash: string): boolean {
  return bcrypt.compareSync(key, hash);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(config.JWT_EXPIRY)
    .sign(secretBytes);
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secretBytes, {
    algorithms: ["HS256"],
  });
  return {
    agentId: String(payload.agentId),
    role: payload.role as Agent["role"],
  };
}

export async function verifyOwnerToken(token: string): Promise<boolean> {
  if (!config.OWNER_TOKEN) return false;
  return token === config.OWNER_TOKEN;
}

export async function resolveAgentByApiKey(key: string): Promise<Agent | null> {
  const rows = await db.select().from(apiKeys);
  for (const row of rows) {
    if (verifyApiKey(key, row.keyHash)) {
      const agentRows = await db.select().from(agents).where(eq(agents.id, row.agentId)).limit(1);
      if (agentRows.length === 0) return null;
      return agentRows[0];
    }
  }
  return null;
}

export async function resolveAgentById(id: string): Promise<Agent | null> {
  const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  return rows[0] ?? null;
}

export function requireRole(agent: Agent, allowed: Agent["role"][]) {
  if (!allowed.includes(agent.role)) {
    throw forbidden();
  }
}

export const authMiddleware = createMiddleware<{
  Variables: { agent: Agent };
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7);
    const agent = await resolveAgentByApiKey(key);
    if (!agent) throw unauthorized("Invalid API key");
    c.set("agent", agent);
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    try {
      const session = await verifySession(token);
      const agent = await resolveAgentById(session.agentId);
      if (!agent) throw unauthorized("Session agent not found");
      c.set("agent", agent);
      return next();
    } catch {
      deleteCookie(c, SESSION_COOKIE);
      throw unauthorized("Invalid or expired session");
    }
  }

  throw unauthorized();
});

export const optionalAuthMiddleware = createMiddleware<{
  Variables: { agent: Agent | null };
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const key = authHeader.slice(7);
    const agent = await resolveAgentByApiKey(key);
    if (agent) {
      c.set("agent", agent);
      return next();
    }
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    try {
      const session = await verifySession(token);
      const agent = await resolveAgentById(session.agentId);
      if (agent) {
        c.set("agent", agent);
        return next();
      }
    } catch {
      deleteCookie(c, SESSION_COOKIE);
    }
  }

  c.set("agent", null);
  return next();
});
