// @ts-nocheck
import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware, requireRole } from "../lib/auth.js";
import type { Agent } from "../db/schema.js";
import { listAgents, createAgent, getAgent, agentToJson } from "../services/agents.js";
import { agentSchema, errorSchema, idParamSchema } from "./common.js";

const app = new OpenAPIHono<{ Variables: { agent: Agent } }>();
app.use("*", authMiddleware);

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: { description: "List of agents", content: { "application/json": { schema: z.array(agentSchema) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(listRoute, async (c) => {
  const data = await listAgents();
  return c.json(data.map(agentToJson));
});

const getRoute = createRoute({
  method: "get",
  path: "/:id",
  tags: ["Agents"],
  request: { params: idParamSchema },
  responses: {
    200: { description: "Agent", content: { "application/json": { schema: agentSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(getRoute, async (c) => {
  const { id } = c.req.valid("params");
  const agent = await getAgent(id);
  return c.json(agentToJson(agent));
});

const createRouteDef = createRoute({
  method: "post",
  path: "/",
  tags: ["Agents"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            displayName: z.string().min(1),
            kind: z.enum(["buzz", "openclaw", "claude", "codex", "manual"]),
            externalId: z.string().optional(),
            role: z.enum(["owner", "editor", "viewer"]).optional(),
            metadata: z.record(z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: agentSchema } } },
    400: { description: "Bad request", content: { "application/json": { schema: errorSchema } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(createRouteDef, async (c) => {
  requireRole(c.get("agent"), ["owner", "editor"]);
  const body = c.req.valid("json");
  const agent = await createAgent(body);
  return c.json(agentToJson(agent), 201);
});

export default app;
