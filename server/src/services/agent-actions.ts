import { createTask, closeTask, reopenTask, assignTask } from "./tasks.js";
import { createComment } from "./comments.js";
import { createResource } from "./resources.js";
import { getBoardBySlug, listBoards } from "./boards.js";
import { badRequest, notFound } from "../lib/errors.js";
import type { Task, Comment, Resource } from "../db/schema.js";

export interface AgentActionInput {
  action:
    | "create_task"
    | "close_task"
    | "reopen_task"
    | "comment"
    | "assign"
    | "attach_resource";
  boardId?: string;
  boardSlug?: string;
  taskId?: string;
  payload: Record<string, unknown>;
}

export type AgentActionResult =
  | { kind: "task"; data: Task }
  | { kind: "comment"; data: Comment }
  | { kind: "resource"; data: Resource };

async function resolveDefaultBoardId(): Promise<string> {
  const boards = await listBoards();
  if (boards.length === 0) throw notFound("Board");
  return boards[0].id;
}

async function resolveBoardId(boardId?: string, boardSlug?: string): Promise<string> {
  if (boardId) return boardId;
  if (boardSlug) {
    const board = await getBoardBySlug(boardSlug);
    return board.id;
  }
  return resolveDefaultBoardId();
}

export async function executeAgentAction(
  agentId: string,
  input: AgentActionInput,
): Promise<AgentActionResult> {
  const { action, payload } = input;

  switch (action) {
    case "create_task": {
      const p = payload as {
        title?: string;
        description?: string;
        priority?: "low" | "medium" | "high" | "urgent";
        tags?: string[];
        status?: string;
        assigneeId?: string;
        dueDate?: number;
      };
      if (!p.title) throw badRequest("create_task requires title");
      const boardId = await resolveBoardId(input.boardId, input.boardSlug);
      const task = await createTask({
        boardId,
        title: p.title,
        description: p.description,
        priority: p.priority,
        tags: p.tags,
        status: p.status,
        assigneeId: p.assigneeId,
        dueDate: p.dueDate,
        createdBy: agentId,
      });
      return { kind: "task", data: task };
    }
    case "close_task": {
      if (!input.taskId) throw badRequest("close_task requires taskId");
      const task = await closeTask(input.taskId, agentId);
      return { kind: "task", data: task };
    }
    case "reopen_task": {
      if (!input.taskId) throw badRequest("reopen_task requires taskId");
      const task = await reopenTask(input.taskId, agentId);
      return { kind: "task", data: task };
    }
    case "comment": {
      const p = payload as { body?: string };
      if (!input.taskId || !p.body) throw badRequest("comment requires taskId and body");
      const comment = await createComment(input.taskId, agentId, p.body);
      return { kind: "comment", data: comment };
    }
    case "assign": {
      const p = payload as { assigneeId?: string };
      if (!input.taskId || !p.assigneeId) throw badRequest("assign requires taskId and assigneeId");
      const task = await assignTask(input.taskId, agentId, p.assigneeId);
      return { kind: "task", data: task };
    }
    case "attach_resource": {
      const p = payload as {
        type?: string;
        source?: string;
        url?: string;
        properties?: Record<string, unknown>;
      };
      if (!input.taskId) throw badRequest("attach_resource requires taskId");
      const resourceType = (p.type ?? "note") as Resource["type"];
      const resource = await createResource({
        taskId: input.taskId,
        type: resourceType,
        source: p.source,
        url: p.url,
        properties: p.properties,
        addedBy: agentId,
      });
      return { kind: "resource", data: resource };
    }
    default:
      throw badRequest("Unknown action");
  }
}
