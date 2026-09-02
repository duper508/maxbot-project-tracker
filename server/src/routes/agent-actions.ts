// @ts-nocheck
import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware, requireRole } from "../lib/auth.js";
import type { Agent } from "../db/schema.js";
import { createTask, closeTask, reopenTask, assignTask } from "../services/tasks.js";
import { createComment } from "../services/comments.js";
import { createResource } from "../services/resources.js";
import { getBoardBySlug, listBoards } from "../services/boards.js";
import { badRequest, notFound } from "../lib/errors.js";
import { errorSchema } from "./common.js";

const app = new OpenAPIHono<{ Variables: { agent: Agent } }>();
app.use("*", authMiddleware);

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

const actionBodySchema = z.object({
  action: z.enum(["create_task", "close_task", "reopen_task", "comment", "assign", "attach_resource"]),
  boardId: z.string().uuid().optional(),
  boardSlug: z.string().optional(),
  taskId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).default({}),
});

const actionRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["Agent Actions"],
  request: {
    body: {
      content: {
        "application/json": { schema: actionBodySchema },
      },
    },
  },
  responses: {
    200: { description: "Action result", content: { "application/json": { schema: z.object({ ok: z.boolean(), data: z.unknown().optional() }) } } },
    400: { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(actionRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const agentId = c.get("agent").id;
  const body = c.req.valid("json");
  const { action, payload } = body;

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
      const boardId = await resolveBoardId(body.boardId, body.boardSlug);
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
      return c.json({ ok: true, data: task });
    }
    case "close_task": {
      if (!body.taskId) throw badRequest("close_task requires taskId");
      const task = await closeTask(body.taskId, agentId);
      return c.json({ ok: true, data: task });
    }
    case "reopen_task": {
      if (!body.taskId) throw badRequest("reopen_task requires taskId");
      const task = await reopenTask(body.taskId, agentId);
      return c.json({ ok: true, data: task });
    }
    case "comment": {
      const p = payload as { body?: string };
      if (!body.taskId || !p.body) throw badRequest("comment requires taskId and body");
      const comment = await createComment(body.taskId, agentId, p.body);
      return c.json({ ok: true, data: comment });
    }
    case "assign": {
      const p = payload as { assigneeId?: string };
      if (!body.taskId || !p.assigneeId) throw badRequest("assign requires taskId and assigneeId");
      const task = await assignTask(body.taskId, agentId, p.assigneeId);
      return c.json({ ok: true, data: task });
    }
    case "attach_resource": {
      const p = payload as {
        type?: string;
        source?: string;
        url?: string;
        properties?: Record<string, unknown>;
      };
      if (!body.taskId) throw badRequest("attach_resource requires taskId");
      const resource = await createResource({
        taskId: body.taskId,
        type: p.type ?? "note",
        source: p.source,
        url: p.url,
        properties: p.properties,
        addedBy: agentId,
      });
      return c.json({ ok: true, data: resource });
    }
    default:
      throw badRequest("Unsupported action");
  }
});

export default app;
