// @ts-nocheck
import { eq, desc } from "drizzle-orm";
import { db } from "../db/index.js";
import { comments } from "../db/schema.js";
import type { Comment, NewComment } from "../db/schema.js";
import { generateId, now } from "../lib/id.js";
import { createActivity } from "./activities.js";

export async function listComments(taskId: string): Promise<Comment[]> {
  return db.select().from(comments).where(eq(comments.taskId, taskId)).orderBy(desc(comments.createdAt));
}

export async function createComment(
  taskId: string,
  agentId: string,
  body: string,
): Promise<Comment> {
  const id = generateId();
  const createdAt = now();
  const comment: NewComment = { id, taskId, agentId, body, createdAt };
  await db.insert(comments).values(comment);
  await createActivity({
    taskId,
    actorId: agentId,
    action: "commented",
    toValue: body.slice(0, 100),
    payload: { commentId: id },
  });
  return comment;
}

export async function deleteComment(id: string): Promise<void> {
  await db.delete(comments).where(eq(comments.id, id));
}
