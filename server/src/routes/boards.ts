import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware, requireRole } from "../lib/auth.js";
import type { Agent } from "../db/schema.js";
import { listBoards, getBoard, createBoard, updateBoard, deleteBoard, boardToJson } from "../services/boards.js";
import { boardSchema, boardColumnSchema, errorSchema, idParamSchema } from "./common.js";

const app = new OpenAPIHono<{ Variables: { agent: Agent } }>();
app.use("*", authMiddleware);

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Boards"],
  responses: {
    200: { description: "List of boards", content: { "application/json": { schema: z.array(boardSchema) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(listRoute, async (c) => {
  const data = await listBoards();
  return c.json(data.map(boardToJson), 200);
});

const getRoute = createRoute({
  method: "get",
  path: "/:id",
  tags: ["Boards"],
  request: { params: idParamSchema },
  responses: {
    200: { description: "Board", content: { "application/json": { schema: boardSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("param");
  const board = await getBoard(id);
  return c.json(boardToJson(board), 200);
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  tags: ["Boards"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1),
            slug: z.string().min(1),
            columns: z.array(boardColumnSchema.omit({ taskIds: true })).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: boardSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(createRouteDef, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const body = c.req.valid("json");
  const board = await createBoard({ ...body, createdBy: c.get("agent").id });
  return c.json(boardToJson(board), 201);
});

const updateRoute = createRoute({
  method: "patch",
  path: "/:id",
  tags: ["Boards"],
  request: {
    params: idParamSchema,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().min(1).optional(),
            columns: z.array(boardColumnSchema.omit({ taskIds: true })).optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: boardSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(updateRoute, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const board = await updateBoard(id, body);
  return c.json(boardToJson(board), 200);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/:id",
  tags: ["Boards"],
  request: { params: idParamSchema },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(deleteRoute, async (c) => {
  requireRole(c.get("agent"), ["owner"]);
  const { id } = c.req.valid("param");
  await deleteBoard(id);
  return c.body(null, 204);
});

export default app;
