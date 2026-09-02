import type { Agent, Board, Task, Activity, TaskStatus } from "../types";
import type { TaskDraft } from "../hooks/useBoardData";

const API_BASE = "/api/v1";

export class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code = "UNKNOWN";
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      if (body.error?.message) message = body.error.message;
      if (body.error?.code) code = body.error.code;
    } catch {
      // fall back to status text
    }
    throw new ApiError(message, code, res.status);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

const TASK_STATUSES: TaskStatus[] = ["backlog", "in-progress", "review", "done"];

function asTaskStatus(status: string): TaskStatus {
  return TASK_STATUSES.includes(status as TaskStatus) ? (status as TaskStatus) : "backlog";
}

function timestampToDate(ts?: number | null): string | undefined {
  if (!ts) return undefined;
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateToTimestamp(date?: string): number | undefined {
  if (!date) return undefined;
  const parsed = Date.parse(date);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function apiTaskToTask(raw: Record<string, unknown>): Task {
  return {
    id: String(raw.id),
    boardId: String(raw.boardId),
    status: asTaskStatus(String(raw.status)),
    title: String(raw.title),
    description: raw.description ? String(raw.description) : undefined,
    priority: String(raw.priority) as Task["priority"],
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    assigneeId: raw.assigneeId ? String(raw.assigneeId) : undefined,
    createdBy: String(raw.createdBy),
    createdAt: Number(raw.createdAt),
    updatedAt: Number(raw.updatedAt),
    closedAt: raw.closedAt ? Number(raw.closedAt) : undefined,
    subtasksCompleted: Number(raw.subtasksCompleted ?? 0),
    subtasksTotal: Number(raw.subtasksTotal ?? 0),
    dueDate: timestampToDate(raw.dueDate as number | null | undefined),
  };
}

function apiAgentToAgent(raw: Record<string, unknown>): Agent {
  return {
    id: String(raw.id),
    displayName: String(raw.displayName),
    kind: String(raw.kind) as Agent["kind"],
    externalId: raw.externalId ? String(raw.externalId) : undefined,
    avatarUrl: raw.avatarUrl ? String(raw.avatarUrl) : undefined,
    initials: String(raw.initials),
    color: String(raw.color),
  };
}

function apiBoardToBoard(raw: Record<string, unknown>): Board {
  return {
    id: String(raw.id),
    name: String(raw.name),
    slug: String(raw.slug),
    columns: Array.isArray(raw.columns)
      ? raw.columns.map((col: Record<string, unknown>) => ({
          id: String(col.id),
          title: String(col.title),
          color: String(col.color),
          order: Number(col.order),
          wipLimit: col.wipLimit ? Number(col.wipLimit) : undefined,
          taskIds: Array.isArray(col.taskIds) ? col.taskIds.map(String) : [],
        }))
      : [],
  };
}

function apiActivityToActivity(raw: Record<string, unknown>): Activity {
  return {
    id: String(raw.id),
    taskId: String(raw.taskId),
    actorId: String(raw.actorId),
    action: String(raw.action),
    fromValue: raw.fromValue ? String(raw.fromValue) : undefined,
    toValue: raw.toValue ? String(raw.toValue) : undefined,
    createdAt: Number(raw.createdAt),
  };
}

interface ListResponse<T> {
  data: T[];
  nextCursor?: string;
}

export async function login(token: string): Promise<void> {
  await request<{ ok: boolean }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function logout(): Promise<void> {
  await request<{ ok: boolean }>("/auth/logout", {
    method: "POST",
  });
}

export async function listBoards(): Promise<Board[]> {
  const boards = await request<Record<string, unknown>[]>("/boards");
  return boards.map(apiBoardToBoard);
}

export async function getBoard(id: string): Promise<Board> {
  const board = await request<Record<string, unknown>>(`/boards/${id}`);
  return apiBoardToBoard(board);
}

export async function listTasks(boardId: string): Promise<Task[]> {
  const res = await request<ListResponse<Record<string, unknown>>>(
    `/tasks/boards/${boardId}/tasks`
  );
  return res.data.map(apiTaskToTask);
}

export async function listAgents(): Promise<Agent[]> {
  const agents = await request<Record<string, unknown>[]>("/agents");
  return agents.map(apiAgentToAgent);
}

export async function listActivities(limit = 20): Promise<Activity[]> {
  const res = await request<ListResponse<Record<string, unknown>>>(
    `/activities?limit=${limit}`
  );
  return res.data.map(apiActivityToActivity);
}

export async function createTask(draft: TaskDraft): Promise<Task> {
  const body = {
    boardId: draft.boardId,
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    tags: draft.tags,
    status: draft.status,
    assigneeId: draft.assigneeId,
    dueDate: dateToTimestamp(draft.dueDate),
  };

  const task = await request<Record<string, unknown>>("/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return apiTaskToTask(task);
}

export async function moveTask(taskId: string, status: string): Promise<Task> {
  const task = await request<Record<string, unknown>>(`/tasks/${taskId}/move`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
  return apiTaskToTask(task);
}

export async function updateTask(
  taskId: string,
  updates: Partial<Omit<Task, "id" | "createdAt" | "updatedAt">>
): Promise<Task> {
  const body: Record<string, unknown> = {};
  if (updates.title !== undefined) body.title = updates.title;
  if (updates.description !== undefined) body.description = updates.description;
  if (updates.priority !== undefined) body.priority = updates.priority;
  if (updates.tags !== undefined) body.tags = updates.tags;
  if (updates.status !== undefined) body.status = updates.status;
  if (updates.assigneeId !== undefined) body.assigneeId = updates.assigneeId;
  if (updates.dueDate !== undefined) body.dueDate = dateToTimestamp(updates.dueDate);

  const task = await request<Record<string, unknown>>(`/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return apiTaskToTask(task);
}
