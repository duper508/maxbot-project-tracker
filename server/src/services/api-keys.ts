import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import type { ApiKey } from "../db/schema.js";
import { generateApiKey } from "../lib/auth.js";
import { generateId, now } from "../lib/id.js";
import { notFound } from "../lib/errors.js";
import { getPrincipal } from "./agents.js";

export async function createApiKey(principalId: string, createdBy: string, name: string): Promise<{ apiKey: ApiKey; token: string }> {
  await getPrincipal(principalId);

  const generated = generateApiKey();
  const apiKey: ApiKey = {
    id: generateId(),
    principalId,
    name,
    prefix: generated.prefix,
    keyHash: generated.keyHash,
    createdBy,
    createdAt: now(),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
  };
  await db.insert(apiKeys).values(apiKey);
  return { apiKey, token: generated.fullKey };
}

export async function listApiKeys(principalId: string): Promise<ApiKey[]> {
  await getPrincipal(principalId);
  return db.select().from(apiKeys).where(eq(apiKeys.principalId, principalId)).orderBy(desc(apiKeys.createdAt));
}

export async function revokeApiKey(principalId: string, keyId: string): Promise<void> {
  const rows = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.principalId, principalId)))
    .limit(1);
  if (rows.length === 0) throw notFound("API key");

  // The auth middleware reads this field from the database on every request,
  // so setting it makes the key unusable immediately.
  await db.update(apiKeys).set({ revokedAt: now() }).where(eq(apiKeys.id, keyId));
}

export function apiKeyToJson(apiKey: ApiKey) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    prefix: apiKey.prefix,
    createdAt: apiKey.createdAt.getTime(),
    lastUsedAt: apiKey.lastUsedAt?.getTime() ?? undefined,
    expiresAt: apiKey.expiresAt?.getTime() ?? undefined,
    revokedAt: apiKey.revokedAt?.getTime() ?? undefined,
  };
}
