// @ts-nocheck
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { resources } from "../db/schema.js";
import type { Resource, NewResource } from "../db/schema.js";
import { generateId, now } from "../lib/id.js";
import { createActivity } from "./activities.js";

export interface CreateResourceInput {
  taskId: string;
  type: Resource["type"];
  source?: string;
  properties?: Record<string, unknown>;
  url?: string;
  addedBy: string;
}

export async function listResources(taskId: string): Promise<Resource[]> {
  return db
    .select()
    .from(resources)
    .where(eq(resources.taskId, taskId))
    .orderBy(desc(resources.createdAt));
}

export async function createResource(input: CreateResourceInput): Promise<Resource> {
  const id = generateId();
  const createdAt = now();
  const resource = {
    id,
    taskId: input.taskId,
    type: input.type,
    source: input.source ?? null,
    properties: input.properties ?? null,
    url: input.url ?? null,
    addedBy: input.addedBy,
    createdAt,
  } as Resource;
  await db.insert(resources).values(resource);
  await createActivity({
    taskId: input.taskId,
    actorId: input.addedBy,
    action: "resource_added",
    toValue: input.type,
    payload: { resourceId: id, url: input.url },
  });
  return resource;
}

export async function deleteResource(id: string): Promise<void> {
  await db.delete(resources).where(eq(resources.id, id));
}
