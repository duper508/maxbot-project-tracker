import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { principals } from "../db/schema.js";
import type { Principal } from "../db/schema.js";
import { generateId, now } from "../lib/id.js";
import { notFound, badRequest } from "../lib/errors.js";

export interface CreatePrincipalInput {
  displayName: string;
  kind: Principal["kind"];
  externalId?: string;
  role?: Principal["role"];
  metadata?: Record<string, unknown>;
}

export async function getPrincipal(id: string): Promise<Principal> {
  const rows = await db.select().from(principals).where(eq(principals.id, id)).limit(1);
  if (rows.length === 0) throw notFound("Agent");
  return rows[0];
}

export async function listPrincipals(): Promise<Principal[]> {
  return db.select().from(principals).orderBy(principals.displayName);
}

export async function findPrincipalByExternalId(
  kind: Principal["kind"],
  externalId: string,
): Promise<Principal | null> {
  const rows = await db
    .select()
    .from(principals)
    .where(and(eq(principals.kind, kind), eq(principals.externalId, externalId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function ensurePrincipal(input: CreatePrincipalInput): Promise<Principal> {
  if (input.externalId) {
    const existing = await findPrincipalByExternalId(input.kind, input.externalId);
    if (existing) return existing;
  }

  const id = generateId();
  const createdAt = now();
  const role = input.role ?? "editor";
  const newPrincipal = {
    id,
    displayName: input.displayName,
    kind: input.kind,
    externalId: input.externalId ?? null,
    role,
    metadata: input.metadata ?? null,
    createdAt,
  } as Principal;
  await db.insert(principals).values(newPrincipal as any);
  return { ...newPrincipal, metadata: input.metadata ?? null };
}

export async function createPrincipal(input: CreatePrincipalInput): Promise<Principal> {
  if (input.externalId) {
    const existing = await findPrincipalByExternalId(input.kind, input.externalId);
    if (existing) throw badRequest(`Agent already exists for ${input.kind}:${input.externalId}`);
  }

  const id = generateId();
  const createdAt = now();
  const role = input.role ?? "editor";
  const newPrincipal = {
    id,
    displayName: input.displayName,
    kind: input.kind,
    externalId: input.externalId ?? null,
    role,
    metadata: input.metadata ?? null,
    createdAt,
  } as Principal;
  await db.insert(principals).values(newPrincipal as any);
  return { ...newPrincipal, metadata: input.metadata ?? null };
}

export function principalToJson(principal: Principal) {
  const meta = (principal.metadata ?? {}) as Record<string, unknown>;
  return {
    id: principal.id,
    displayName: principal.displayName,
    kind: principal.kind,
    externalId: principal.externalId ?? undefined,
    role: principal.role,
    avatarUrl: (meta.avatarUrl as string | undefined) ?? undefined,
    initials: (meta.initials as string | undefined) ?? principal.displayName.slice(0, 2).toUpperCase(),
    color: (meta.color as string | undefined) ?? "#f59e0b",
  };
}

export const ensureAgent = ensurePrincipal;
