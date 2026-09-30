import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware, requireRole } from "../lib/auth.js";
import type { Principal } from "../db/schema.js";
import { listPrincipals, createPrincipal, getPrincipal, principalToJson } from "../services/agents.js";
import { createApiKey, listApiKeys, revokeApiKey, apiKeyToJson } from "../services/api-keys.js";
import { agentSchema, apiKeySchema, errorSchema, idParamSchema } from "./common.js";

const app = new OpenAPIHono<{ Variables: { principal: Principal } }>();
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
  const data = await listPrincipals();
  return c.json(data.map(principalToJson), 200);
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
  const { id } = c.req.valid("param");
  const principal = await getPrincipal(id);
  return c.json(principalToJson(principal), 200);
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
            kind: z.enum(["buzz", "openclaw", "claude", "codex", "manual", "human"]),
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
  requireRole(c.get("principal"), ["owner", "editor"]);
  const body = c.req.valid("json");
  const principal = await createPrincipal(body);
  return c.json(principalToJson(principal), 201);
});

const keyIdParamSchema = z.object({
  id: z.string().uuid(),
  keyId: z.string().uuid(),
});

const listKeysRoute = createRoute({
  method: "get",
  path: "/:id/keys",
  tags: ["Agent API keys"],
  request: { params: idParamSchema },
  responses: {
    200: { description: "Agent API keys", content: { "application/json": { schema: z.array(apiKeySchema) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(listKeysRoute, async (c) => {
  requireRole(c.get("principal"), ["owner"]);
  const { id } = c.req.valid("param");
  const keys = await listApiKeys(id);
  return c.json(keys.map(apiKeyToJson), 200);
});

const createKeyRoute = createRoute({
  method: "post",
  path: "/:id/keys",
  tags: ["Agent API keys"],
  request: {
    params: idParamSchema,
    body: { content: { "application/json": { schema: z.object({ name: z.string().trim().min(1).max(100) }) } } },
  },
  responses: {
    201: {
      description: "API key created. The token is returned only in this response.",
      content: { "application/json": { schema: z.object({ apiKey: apiKeySchema, token: z.string() }) } },
    },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(createKeyRoute, async (c) => {
  requireRole(c.get("principal"), ["owner"]);
  const { id } = c.req.valid("param");
  const { name } = c.req.valid("json");
  const result = await createApiKey(id, c.get("principal").id, name);
  return c.json({ apiKey: apiKeyToJson(result.apiKey), token: result.token }, 201);
});

const revokeKeyRoute = createRoute({
  method: "delete",
  path: "/:id/keys/:keyId",
  tags: ["Agent API keys"],
  request: { params: keyIdParamSchema },
  responses: {
    204: { description: "API key revoked" },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(revokeKeyRoute, async (c) => {
  requireRole(c.get("principal"), ["owner"]);
  const { id, keyId } = c.req.valid("param");
  await revokeApiKey(id, keyId);
  return c.body(null, 204);
});

export default app;
