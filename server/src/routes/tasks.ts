// @ts-nocheck
import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware, requireRole } from "../lib/auth.js";
import type { Agent } from "../db/schema.js";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  deleteTask,
  moveTask,
  assignTask,
  closeTask,
  reopenTask,
} from "../services/tasks.js";
import { listComments, createComment } from "../services/comments.js";
import { listResources, createResource } from "../services/resources.js";
import {
  taskSchema,
  commentSchema,
  resourceSchema,
  activitySchema,
  listResponse,
  errorSchema,
  idParamSchema,
  boardIdParamSchema,
  taskToJson,
  commentToJson,
  resourceToJson,
  activityToJson,
} from "./common.js";
import { listActivities } from "../services/activities.js";

const app = new OpenAPIHono<{ Variables: { agent: Agent } }>();
app.use("*", authMiddleware);

const priorityEnum = z.enum(["low", "medium", "high", "urgent"]);

// GET /boards/:boardId/tasks
const listRoute = createRoute({
  method: "get",
  path: "/boards/:boardId/tasks",
  tags: ["Tasks"],
  request: {
    params: boardIdParamSchema,
    query: z.object({
      status: z.string().optional(),
      priority: priorityEnum.optional(),
      assignee: z.string().uuid().optional(),
      tag: z.string().optional(),
      q: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "List of tasks", content: { "application/json": { schema: listResponse(taskSchema) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(listRoute, async (c) => {
  const { boardId } = c.req.valid("params");
  const query = c.req.valid("query");
  const result = await listTasks({ boardId, ...query });
  return c.json({ data: result.data.map(taskToJson), nextCursor: result.nextCursor });
});

// POST /tasks
const createRouteDef = createRoute({
  method: "post",
  path: "/",
  tags: ["Tasks"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            boardId: z.string().uuid(),
            title: z.string().min(1),
            description: z.string().optional(),
            priority: priorityEnum.optional(),
            tags: z.array(z.string()).optional(),
            status: z.string().optional(),
            assigneeId: z.string().uuid().optional(),
            dueDate: z.number().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: taskSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(createRouteDef, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const body = c.req.valid("json");
  const task = await createTask({ ...body, createdBy: c.get("agent").id });
  return c.json(taskToJson(task), 201);
});

// GET /tasks/:id
const getRoute = createRoute({
  method: "get",
  path: "/:id",
  tags: ["Tasks"],
  request: { params: idParamSchema },
  responses: {
    200: { description: "Task", content: { "application/json": { schema: taskSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("params");
  const task = await getTask(id);
  return c.json(taskToJson(task));
});

// PATCH /tasks/:id
const updateRoute = createRoute({
  method: "patch",
  path: "/:id",
  tags: ["Tasks"],
  request: {
    params: idParamSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            title: z.string().min(1).optional(),
            description: z.string().optional().nullable(),
            priority: priorityEnum.optional(),
            tags: z.array(z.string()).optional(),
            status: z.string().optional(),
            assigneeId: z.string().uuid().optional().nullable(),
            dueDate: z.number().optional().nullable(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: taskSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(updateRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  const body = c.req.valid("json");
  const task = await updateTask(id, c.get("agent").id, body);
  return c.json(taskToJson(task));
});

// DELETE /tasks/:id
const deleteRoute = createRoute({
  method: "delete",
  path: "/:id",
  tags: ["Tasks"],
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(deleteRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  await deleteTask(id);
  return c.body(null, 204);
});

// POST /tasks/:id/move
const moveRoute = createRoute({
  method: "post",
  path: "/:id/move",
  tags: ["Tasks"],
  request: {
    params: idParamSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({ status: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: { description: "Moved", content: { "application/json": { schema: taskSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(moveRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  const { status } = c.req.valid("json");
  const task = await moveTask(id, c.get("agent").id, status);
  return c.json(taskToJson(task));
});

// POST /tasks/:id/assign
const assignRoute = createRoute({
  method: "post",
  path: "/:id/assign",
  tags: ["Tasks"],
  request: {
    params: idParamSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({ agentId: z.string().uuid().nullable() }),
        },
      },
    },
  },
  responses: {
    200: { description: "Assigned", content: { "application/json": { schema: taskSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(assignRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  const { agentId } = c.req.valid("json");
  const task = await assignTask(id, c.get("agent").id, agentId);
  return c.json(taskToJson(task));
});

// POST /tasks/:id/close
const closeRoute = createRoute({
  method: "post",
  path: "/:id/close",
  tags: ["Tasks"],
  request: { params: idParamSchema },
  responses: {
    200: { description: "Closed", content: { "application/json": { schema: taskSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(closeRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  const task = await closeTask(id, c.get("agent").id);
  return c.json(taskToJson(task));
});

// POST /tasks/:id/reopen
const reopenRoute = createRoute({
  method: "post",
  path: "/:id/reopen",
  tags: ["Tasks"],
  request: { params: idParamSchema },
  responses: {
    200: { description: "Reopened", content: { "application/json": { schema: taskSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(reopenRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  const task = await reopenTask(id, c.get("agent").id);
  return c.json(taskToJson(task));
});

// Comments
const listCommentsRoute = createRoute({
  method: "get",
  path: "/:id/comments",
  tags: ["Comments"],
  request: { params: idParamSchema },
  responses: {
    200: { description: "Comments", content: { "application/json": { schema: z.array(commentSchema) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(listCommentsRoute, async (c) => {
  const { id } = c.req.valid("params");
  const data = await listComments(id);
  return c.json(data.map(commentToJson));
});

const createCommentRoute = createRoute({
  method: "post",
  path: "/:id/comments",
  tags: ["Comments"],
  request: {
    params: idParamSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({ body: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: commentSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(createCommentRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  const { body } = c.req.valid("json");
  const comment = await createComment(id, c.get("agent").id, body);
  return c.json(commentToJson(comment), 201);
});

// Resources
const listResourcesRoute = createRoute({
  method: "get",
  path: "/:id/resources",
  tags: ["Resources"],
  request: { params: idParamSchema },
  responses: {
    200: { description: "Resources", content: { "application/json": { schema: z.array(resourceSchema) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(listResourcesRoute, async (c) => {
  const { id } = c.req.valid("params");
  const data = await listResources(id);
  return c.json(data.map(resourceToJson));
});

const createResourceRoute = createRoute({
  method: "post",
  path: "/:id/resources",
  tags: ["Resources"],
  request: {
    params: idParamSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            type: z.string().min(1),
            source: z.string().optional(),
            url: z.string().optional(),
            properties: z.record(z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: resourceSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(createResourceRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  const body = c.req.valid("json");
  const resource = await createResource({ ...body, taskId: id, addedBy: c.get("agent").id });
  return c.json(resourceToJson(resource), 201);
});

// DELETE /resources/:id
const deleteResourceRoute = createRoute({
  method: "delete",
  path: "/resources/:id",
  tags: ["Resources"],
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted" },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(deleteResourceRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("params");
  const { deleteResource } = await import("../services/resources.js");
  await deleteResource(id);
  return c.body(null, 204);
});

// Activities for a task
const listTaskActivitiesRoute = createRoute({
  method: "get",
  path: "/:id/activities",
  tags: ["Activities"],
  request: {
    params: idParamSchema,
    query: z.object({
      limit: z.coerce.number().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Activities", content: { "application/json": { schema: listResponse(activitySchema) } } },
  },
});

app.openapi(listTaskActivitiesRoute, async (c) => {
  const { id } = c.req.valid("params");
  const query = c.req.valid("query");
  const result = await listActivities({ taskId: id, ...query });
  return c.json({ data: result.data.map(activityToJson), nextCursor: result.nextCursor });
});

export default app;
