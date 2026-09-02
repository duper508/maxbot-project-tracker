import { z } from "zod";

export const idParamSchema = z.object({
  id: z.string().uuid(),
});

export const boardIdParamSchema = z.object({
  boardId: z.string().uuid(),
});

export const listResponse = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    nextCursor: z.string().optional(),
  });

export const agentSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  kind: z.enum(["buzz", "openclaw", "claude", "codex", "manual"]),
  externalId: z.string().optional(),
  role: z.enum(["owner", "editor", "viewer"]),
  avatarUrl: z.string().optional(),
  initials: z.string(),
  color: z.string(),
});

export const boardColumnSchema = z.object({
  id: z.string(),
  title: z.string(),
  color: z.string(),
  order: z.number(),
  wipLimit: z.number().optional(),
  taskIds: z.array(z.string()).optional(),
});

export const boardSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  columns: z.array(boardColumnSchema),
});

export const taskSchema = z.object({
  id: z.string().uuid(),
  boardId: z.string().uuid(),
  status: z.string(),
  title: z.string(),
  description: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  tags: z.array(z.string()),
  assigneeId: z.string().uuid().optional(),
  createdBy: z.string().uuid(),
  createdAt: z.number(),
  updatedAt: z.number(),
  closedAt: z.number().optional(),
  dueDate: z.number().optional(),
  subtasksCompleted: z.number().default(0),
  subtasksTotal: z.number().default(0),
});

export const commentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  agentId: z.string().uuid(),
  body: z.string(),
  createdAt: z.number(),
});

export const resourceSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  type: z.enum(["buzz-message", "openclaw-artifact", "github-pr", "github-issue", "doc", "url", "note"]),
  source: z.string().optional(),
  url: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
  addedBy: z.string().uuid(),
  createdAt: z.number(),
});

export const activitySchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  actorId: z.string().uuid(),
  action: z.string(),
  fromValue: z.string().optional(),
  toValue: z.string().optional(),
  createdAt: z.number(),
});

export const errorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string(),
  }),
});

export function taskToJson(task: import("../db/schema.js").Task) {
  return {
    id: task.id,
    boardId: task.boardId,
    status: task.status,
    title: task.title,
    description: task.description ?? undefined,
    priority: task.priority,
    tags: task.tags,
    assigneeId: task.assigneeId ?? undefined,
    createdBy: task.createdBy,
    createdAt: task.createdAt.getTime(),
    updatedAt: task.updatedAt.getTime(),
    closedAt: task.closedAt?.getTime() ?? undefined,
    dueDate: task.dueDate?.getTime() ?? undefined,
    subtasksCompleted: 0,
    subtasksTotal: 0,
  };
}

export function commentToJson(comment: import("../db/schema.js").Comment) {
  return {
    id: comment.id,
    taskId: comment.taskId,
    agentId: comment.agentId,
    body: comment.body,
    createdAt: comment.createdAt.getTime(),
  };
}

export function resourceToJson(resource: import("../db/schema.js").Resource) {
  return {
    id: resource.id,
    taskId: resource.taskId,
    type: resource.type,
    source: resource.source ?? undefined,
    url: resource.url ?? undefined,
    properties: (resource.properties as Record<string, unknown>) ?? undefined,
    addedBy: resource.addedBy,
    createdAt: resource.createdAt.getTime(),
  };
}

export function activityToJson(activity: import("../db/schema.js").Activity) {
  return {
    id: activity.id,
    taskId: activity.taskId,
    actorId: activity.actorId,
    action: activity.action,
    fromValue: activity.fromValue ?? undefined,
    toValue: activity.toValue ?? undefined,
    createdAt: activity.createdAt.getTime(),
  };
}
