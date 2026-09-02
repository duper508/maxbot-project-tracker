import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware, requireRole } from "../lib/auth.js";
import type { Agent } from "../db/schema.js";
import { executeAgentAction } from "../services/agent-actions.js";
import { createResource } from "../services/resources.js";
import { errorSchema, taskToJson, commentToJson, resourceToJson } from "./common.js";

const app = new OpenAPIHono<{ Variables: { agent: Agent } }>();
app.use("*", authMiddleware);

const artifactSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  url: z.string().optional(),
  type: z.string().optional(),
});

const openclawBodySchema = z.object({
  action: z.enum([
    "create_task",
    "close_task",
    "reopen_task",
    "comment",
    "assign",
    "attach_resource",
  ]),
  boardId: z.string().uuid().optional(),
  boardSlug: z.string().optional(),
  taskId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).default({}),
  artifact: artifactSchema.optional(),
});

const openclawRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["OpenClaw"],
  request: {
    body: {
      content: {
        "application/json": { schema: openclawBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Action result",
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), data: z.any().optional() }),
        },
      },
    },
    400: { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(openclawRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const agentId = c.get("agent").id;
  const body = c.req.valid("json");

  const result = await executeAgentAction(agentId, {
    action: body.action,
    boardId: body.boardId,
    boardSlug: body.boardSlug,
    taskId: body.taskId,
    payload: body.payload,
  });

  let taskIdForArtifact: string | undefined;
  if (result.kind === "task") {
    taskIdForArtifact = result.data.id;
  } else if (result.kind === "comment") {
    taskIdForArtifact = result.data.taskId;
  } else if (result.kind === "resource") {
    taskIdForArtifact = result.data.taskId;
  }

  if (body.artifact && taskIdForArtifact) {
    await createResource({
      taskId: taskIdForArtifact,
      type: "openclaw-artifact",
      source: body.artifact.id,
      url: body.artifact.url,
      properties: {
        name: body.artifact.name,
        artifactType: body.artifact.type,
      },
      addedBy: agentId,
    });
  }

  let data: unknown;
  switch (result.kind) {
    case "task":
      data = taskToJson(result.data);
      break;
    case "comment":
      data = commentToJson(result.data);
      break;
    case "resource":
      data = resourceToJson(result.data);
      break;
  }
  return c.json({ ok: true, data }, 200);
});

export default app;
