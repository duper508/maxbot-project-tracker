import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { agents, apiKeys } from "../db/schema.js";
import type { Agent, ApiKey } from "../db/schema.js";
import { generateId, now } from "../lib/id.js";
import { hashApiKey } from "../lib/auth.js";
import { notFound, badRequest } from "../lib/errors.js";

export interface CreateAgentInput {
  displayName: string;
  kind: Agent["kind"];
  externalId?: string;
  role?: Agent["role"];
  metadata?: Record<string, unknown>;
}

export async function getAgent(id: string): Promise<Agent> {
  const rows = await db.select().from(agents).where(eq(agents.id, id)).limit(1);
  if (rows.length === 0) throw notFound("Agent");
  return rows[0];
}

export async function listAgents(): Promise<Agent[]> {
  return db.select().from(agents).orderBy(agents.displayName);
}

export async function findAgentByExternalId(
  kind: Agent["kind"],
  externalId: string,
): Promise<Agent | null> {
  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.kind, kind), eq(agents.externalId, externalId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensureAgent(input: CreateAgentInput): Promise<Agent> {
  if (input.externalId) {
    const existing = await findAgentByExternalId(input.kind, input.externalId);
    if (existing) return existing;
  }

  const id = generateId();
  const createdAt = now();
  const role = input.role ?? "editor";
  const newAgent = {
    id,
    displayName: input.displayName,
    kind: input.kind,
    externalId: input.externalId ?? null,
    role,
    metadata: input.metadata ?? null,
    createdAt,
  } as Agent;
  await db.insert(agents).values(newAgent as any);
  return { ...newAgent, metadata: input.metadata ?? null };
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  if (input.externalId) {
    const existing = await findAgentByExternalId(input.kind, input.externalId);
    if (existing) throw badRequest(`Agent already exists for ${input.kind}:${input.externalId}`);
  }

  const id = generateId();
  const createdAt = now();
  const role = input.role ?? "editor";
  const newAgent = {
    id,
    displayName: input.displayName,
    kind: input.kind,
    externalId: input.externalId ?? null,
    role,
    metadata: input.metadata ?? null,
    createdAt,
  } as Agent;
  await db.insert(agents).values(newAgent as any);
  return { ...newAgent, metadata: input.metadata ?? null };
}

export async function seedApiKey(agentId: string, name: string, key: string, role: Agent["role"]): Promise<ApiKey> {
  const id = generateId();
  const createdAt = now();
  await db.insert(apiKeys).values({
    id,
    agentId,
    keyHash: hashApiKey(key),
    name,
    role,
    createdAt,
  } as any);
  return {
    id,
    agentId,
    keyHash: "",
    name,
    role,
    createdAt,
    lastUsedAt: null,
  };
}

export function agentToJson(agent: Agent) {
  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  return {
    id: agent.id,
    displayName: agent.displayName,
    kind: agent.kind,
    externalId: agent.externalId ?? undefined,
    role: agent.role,
    avatarUrl: (meta.avatarUrl as string | undefined) ?? undefined,
    initials: (meta.initials as string | undefined) ?? agent.displayName.slice(0, 2).toUpperCase(),
    color: (meta.color as string | undefined) ?? "#f59e0b",
  };
}
