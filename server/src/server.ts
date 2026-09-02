import { readFile } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { OpenAPIHono } from "@hono/zod-openapi";
import { swaggerUI } from "@hono/swagger-ui";
import { migrate } from "drizzle-orm/libsql/migrator";
import { config } from "./config.js";
import { db } from "./db/index.js";
import { seedDatabase } from "./services/seed.js";
import { KanbanError } from "./lib/errors.js";
import authRoutes from "./routes/auth.js";
import agentRoutes from "./routes/agents.js";
import boardRoutes from "./routes/boards.js";
import taskRoutes from "./routes/tasks.js";
import activityRoutes from "./routes/activities.js";
import webhookRoutes from "./routes/webhooks.js";
import agentActionRoutes from "./routes/agent-actions.js";

const app = new OpenAPIHono();

app.onError((err, c) => {
  if (err instanceof KanbanError) {
    return c.json({ error: { message: err.message, code: err.code } }, err.status);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: { message: "Internal server error", code: "INTERNAL" } }, 500);
});

app.notFound((c) => c.json({ error: { message: "Not found", code: "NOT_FOUND" } }, 404));

// Health check
app.get("/health", (c) => c.json({ ok: true }));

// API routes
app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/agents", agentRoutes);
app.route("/api/v1/boards", boardRoutes);
app.route("/api/v1/tasks", taskRoutes);
app.route("/api/v1/activities", activityRoutes);
app.route("/api/v1/webhooks", webhookRoutes);
app.route("/api/v1/agent-actions", agentActionRoutes);

// OpenAPI docs
app.doc("/api/v1/openapi.json", {
  openapi: "3.0.0",
  info: {
    title: "Buzz Kanban API",
    version: "0.0.1",
  },
});
app.get("/api/v1/docs", swaggerUI({ url: "/api/v1/openapi.json" }));

// Static files + SPA fallback
const distPath = new URL("../../dist", import.meta.url).pathname;
app.use("/*", serveStatic({ root: distPath }));
app.get("/*", async (c, next) => {
  // Skip API routes
  if (c.req.path.startsWith("/api/v1")) return next();
  const html = await readFile(`${distPath}/index.html`, "utf-8");
  return c.html(html);
});

async function bootstrap() {
  await migrate(db, { migrationsFolder: "./migrations" });
  await seedDatabase();

  serve({
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST,
  });

  console.log(`Buzz Kanban server running at http://${config.HOST}:${config.PORT}`);
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});

export { app };
