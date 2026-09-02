// @ts-nocheck
import { eq, desc, and, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { activities } from "../db/schema.js";
import type { Activity, NewActivity } from "../db/schema.js";
import { generateId, now } from "../lib/id.js";

const PAGE_SIZE = 50;

export interface ActivityListInput {
  taskId?: string;
  limit?: number;
  cursor?: string;
}

export interface ActivityListResult {
  data: Activity[];
  nextCursor?: string;
}

export async function createActivity(
  input: Omit<NewActivity, "id" | "createdAt">,
): Promise<Activity> {
  const id = generateId();
  const createdAt = now();
  const activity = {
    id,
    taskId: input.taskId,
    actorId: input.actorId,
    action: input.action,
    fromValue: input.fromValue ?? null,
    toValue: input.toValue ?? null,
    payload: input.payload ?? null,
    createdAt,
  } as Activity;
  await db.insert(activities).values(activity as NewActivity);
  return activity;
}

export async function listActivities(input: ActivityListInput): Promise<ActivityListResult> {
  const limit = input.limit && input.limit > 0 ? Math.min(input.limit, PAGE_SIZE) : PAGE_SIZE;
  const conditions = [];
  if (input.taskId) conditions.push(eq(activities.taskId, input.taskId));
  if (input.cursor) conditions.push(lt(activities.createdAt, new Date(Number(input.cursor))));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(activities)
    .where(where)
    .orderBy(desc(activities.createdAt))
    .limit(limit + 1);

  const data = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? String(data[data.length - 1]?.createdAt) : undefined;
  return { data, nextCursor };
}
