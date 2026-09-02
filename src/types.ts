export type Priority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "backlog" | "in-progress" | "review" | "done";

export interface Agent {
  id: string;
  displayName: string;
  kind: "buzz" | "openclaw" | "claude" | "codex" | "manual";
  externalId?: string;
  avatarUrl?: string;
  initials: string;
  color: string;
}

export interface BoardColumn {
  id: string;
  title: string;
  color: string;
  order: number;
  taskIds: string[];
  wipLimit?: number;
}

export interface Board {
  id: string;
  name: string;
  slug: string;
  columns: BoardColumn[];
}

export interface Task {
  id: string;
  boardId: string;
  status: TaskStatus;
  title: string;
  description?: string;
  priority: Priority;
  tags: string[];
  assigneeId?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  closedAt?: number;
  subtasksCompleted: number;
  subtasksTotal: number;
  dueDate?: string;
}

export interface Comment {
  id: string;
  taskId: string;
  agentId: string;
  body: string;
  createdAt: number;
}

export interface Resource {
  id: string;
  taskId: string;
  type: string;
  source?: string;
  url?: string;
  properties: Record<string, unknown>;
  addedBy: string;
  createdAt: number;
}

export interface Activity {
  id: string;
  taskId: string;
  actorId: string;
  action: string;
  fromValue?: string;
  toValue?: string;
  createdAt: number;
}
