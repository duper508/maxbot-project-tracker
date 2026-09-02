import { defineConfig } from "drizzle-kit";

const sqlitePath = process.env.SQLITE_PATH ?? "file:./data/kanban.db";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: sqlitePath,
  },
});
