// @ts-nocheck
import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware } from "../lib/auth.js";
import type { Agent } from "../db/schema.js";
import { listActivities } from "../services/activities.js";
import { activitySchema, listResponse, errorSchema } from "./common.js";

const app = new OpenAPIHono<{ Variables: { agent: Agent } }>();
app.use("*", authMiddleware);

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Activities"],
  request: {
    query: z.object({
      taskId: z.string().uuid().optional(),
      limit: z.coerce.number().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: { description: "Activities", content: { "application/json": { schema: listResponse(activitySchema) } } },
    401: { description: "Unauthorized", content: { "application/json": { schema: errorSchema } } },
  },
});

app.openapi(listRoute, async (c) => {
  const query = c.req.valid("query");
  const result = await listActivities(query);
  return c.json(result);
});

export default app;
