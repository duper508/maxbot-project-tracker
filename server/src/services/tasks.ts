// @ts-nocheck
import { eq, and, desc, like, or, SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { tasks } from "../db/schema.js";
import type { Task, NewTask } from "../db/schema.js";
import { generateId, now } from "../lib/id.js";
import { notFound, badRequest } from "../lib/errors.js";
import { createActivity } from "./activities.js";
import { getBoard, type BoardColumnInput } from "./boards.js";
import { getAgent } from "./agents.js";

const PAGE_SIZE = 100;

export interface TaskListInput {
  boardId: string;
  status?: string;
  priority?: Task["priority"];
  assignee?: string;
  tag?: string;
  q?: string;
}

export interface TaskListResult {
  data: Task[];
  nextCursor?: string;
}

export interface CreateTaskInput {
  boardId: string;
  title: string;
  description?: string;
  priority?: Task["priority"];
  tags?: string[];
  status?: string;
  assigneeId?: string;
  dueDate?: number;
  createdBy: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  priority?: Task["priority"];
  tags?: string[];
  status?: string;
  assigneeId?: string | null;
  dueDate?: number | null;
}

async function validateStatus(boardId: string, status: string): Promise<string> {
  const board = await getBoard(boardId);
  const columns = board.columns as BoardColumnInput[];
  const valid = columns.some((c) => c.id === status);
  if (!valid) throw badRequest(`Invalid status "${status}" for this board`);
  return status;
}

async function validateAssignee(assigneeId?: string | null): Promise<string | undefined> {
  if (assigneeId === null || assigneeId === undefined) return undefined;
  await getAgent(assigneeId);
  return assigneeId;
}

export async function getTask(id: string): Promise<Task> {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (rows.length === 0) throw notFound("Task");
  return rows[0];
}

export async function listTasks(input: TaskListInput): Promise<TaskListResult> {
  const conditions: SQL<unknown>[] = [eq(tasks.boardId, input.boardId)];
  if (input.status) conditions.push(eq(tasks.status, input.status));
  if (input.priority) conditions.push(eq(tasks.priority, input.priority));
  if (input.assignee) conditions.push(eq(tasks.assigneeId, input.assignee));
  if (input.tag) conditions.push(like(tasks.tags, `%"${input.tag}"%`));
  if (input.q) {
    const term = `%${input.q}%`;
    conditions.push(or(like(tasks.title, term), like(tasks.description, term)) as SQL<unknown>);
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(desc(tasks.createdAt))
    .limit(PAGE_SIZE + 1);

  const data = rows.slice(0, PAGE_SIZE);
  const nextCursor = rows.length > PAGE_SIZE ? String(data[data.length - 1]?.createdAt) : undefined;
  return { data, nextCursor };
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const board = await getBoard(input.boardId);
  const status = input.status ?? (board.columns as BoardColumnInput[])[0].id;
  await validateStatus(input.boardId, status);
  const assigneeId = await validateAssignee(input.assigneeId);

  const id = generateId();
  const timestamp = now();
  const task = {
    id,
    boardId: input.boardId,
    status,
    title: input.title,
    description: input.description ?? null,
    priority: input.priority ?? "medium",
    tags: input.tags ?? [],
    assigneeId: assigneeId ?? null,
    createdBy: input.createdBy,
    createdAt: timestamp,
    updatedAt: timestamp,
    closedAt: null,
    dueDate: input.dueDate ? new Date(input.dueDate) : null,
  } as Task;

  await db.insert(tasks).values(task as NewTask);
  await createActivity({
    taskId: id,
    actorId: input.createdBy,
    action: "created",
    toValue: status,
    payload: { title: input.title },
  });
  return task;
}

export async function updateTask(id: string, actorId: string, input: UpdateTaskInput): Promise<Task> {
  const task = await getTask(id);
  const updates: Partial<NewTask> = { updatedAt: now() };

  if (input.title !== undefined) updates.title = input.title;
  if (input.description !== undefined) updates.description = input.description;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.tags !== undefined) updates.tags = input.tags;
  if (input.dueDate !== undefined) updates.dueDate = input.dueDate ? new Date(input.dueDate) : null;

  if (input.status !== undefined) {
    updates.status = await validateStatus(task.boardId, input.status);
  }
  if (input.assigneeId !== undefined) {
    updates.assigneeId = (await validateAssignee(input.assigneeId)) ?? null;
  }

  await db.update(tasks).set(updates).where(eq(tasks.id, id));
  const updated = { ...task, ...updates } as Task;

  const activityPayload: Record<string, unknown> = {};
  if (input.status && input.status !== task.status) {
    activityPayload.fromStatus = task.status;
    activityPayload.toStatus = input.status;
  }
  if (input.assigneeId !== undefined && input.assigneeId !== task.assigneeId) {
    activityPayload.fromAssignee = task.assigneeId;
    activityPayload.toAssignee = input.assigneeId;
  }

  if (Object.keys(activityPayload).length > 0) {
    await createActivity({
      taskId: id,
      actorId,
      action: "updated",
      fromValue: task.status,
      toValue: updated.status,
      payload: activityPayload,
    });
  }

  return updated;
}

export async function moveTask(id: string, actorId: string, status: string): Promise<Task> {
  return updateTask(id, actorId, { status });
}

export async function assignTask(id: string, actorId: string, assigneeId: string | null): Promise<Task> {
  return updateTask(id, actorId, { assigneeId });
}

export async function closeTask(id: string, actorId: string): Promise<Task> {
  const task = await getTask(id);
  const updates: Partial<NewTask> = {
    status: "done",
    closedAt: now(),
    updatedAt: now(),
  };
  await db.update(tasks).set(updates).where(eq(tasks.id, id));
  await createActivity({
    taskId: id,
    actorId,
    action: "closed",
    fromValue: task.status,
    toValue: "done",
  });
  return { ...task, ...updates } as Task;
}

export async function reopenTask(id: string, actorId: string): Promise<Task> {
  const task = await getTask(id);
  const board = await getBoard(task.boardId);
  const firstColumn = (board.columns as BoardColumnInput[])[0].id;
  const updates: Partial<NewTask> = {
    status: firstColumn,
    closedAt: null,
    updatedAt: now(),
  };
  await db.update(tasks).set(updates).where(eq(tasks.id, id));
  await createActivity({
    taskId: id,
    actorId,
    action: "reopened",
    fromValue: task.status,
    toValue: firstColumn,
  });
  return { ...task, ...updates } as Task;
}

export async function deleteTask(id: string): Promise<void> {
  await getTask(id);
  await db.delete(tasks).where(eq(tasks.id, id));
}
