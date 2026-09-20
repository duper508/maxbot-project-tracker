import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

const V1_SCHEMA = `
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"payload" text,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("actor_id") REFERENCES "agents"("id") ON UPDATE no action ON DELETE restrict
);
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"role" text DEFAULT 'editor' NOT NULL,
	"metadata" text,
	"created_at" integer NOT NULL
);
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"last_used_at" integer,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON UPDATE no action ON DELETE cascade
);
CREATE TABLE "boards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"columns" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	"created_by" text NOT NULL,
	FOREIGN KEY ("created_by") REFERENCES "agents"("id") ON UPDATE no action ON DELETE restrict
);
CREATE UNIQUE INDEX "boards_slug_unique" ON "boards" ("slug");
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON UPDATE no action ON DELETE restrict
);
CREATE TABLE "resources" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"type" text NOT NULL,
	"source" text,
	"properties" text,
	"url" text,
	"added_by" text NOT NULL,
	"created_at" integer NOT NULL,
	FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("added_by") REFERENCES "agents"("id") ON UPDATE no action ON DELETE restrict
);
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"assignee_id" text,
	"created_by" text NOT NULL,
	"created_at" integer NOT NULL,
	"updated_at" integer NOT NULL,
	"closed_at" integer,
	"due_date" integer,
	FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY ("assignee_id") REFERENCES "agents"("id") ON UPDATE no action ON DELETE set null,
	FOREIGN KEY ("created_by") REFERENCES "agents"("id") ON UPDATE no action ON DELETE restrict
);
`;

const V1_MIGRATION_HASH = "411473f63c27f56be8dda1e0c91c1d0f7299fa27005f5f7a39607bb3e8d8592c";
// Drizzle's journal timestamp for 0000; must be < 0001's `when` so migrate() applies 0001.
const V1_MIGRATION_MILLIS = 1788382295970;

async function createV1Database(): Promise<ReturnType<typeof createClient>> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF;");
  for (const statement of V1_SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
    await client.execute(statement);
  }
  await client.execute("PRAGMA foreign_keys = ON;");

  // Mark the v1 schema migration as already applied so drizzle only runs 0001.
  await client.execute(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
  await client.execute({
    sql: "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
    args: [V1_MIGRATION_HASH, V1_MIGRATION_MILLIS],
  });

  return client;
}

describe("A1 migration", () => {
  beforeEach(async () => {
    // Each test gets its own in-memory database created in-place by migrate().
  });

  it("renames agents to principals and keeps foreign keys valid", async () => {
    const v1Client = await createV1Database();

    // Seed a v1 owner row and a board/task so foreign keys are exercised.
    await v1Client.execute(`
      INSERT INTO agents (id, display_name, kind, role, created_at) VALUES
      ('00000000-0000-0000-0000-000000000001', 'Owner', 'manual', 'owner', 1000),
      ('00000000-0000-0000-0000-000000000002', 'OpenClaw', 'openclaw', 'editor', 1000);
    `);
    await v1Client.execute(`
      INSERT INTO boards (id, name, slug, columns, created_at, updated_at, created_by) VALUES
      ('00000000-0000-0000-0000-000000000010', 'Main', 'main', '[]', 1000, 1000, '00000000-0000-0000-0000-000000000001');
    `);
    await v1Client.execute(`
      INSERT INTO tasks (id, board_id, status, title, priority, tags, created_by, created_at, updated_at) VALUES
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'backlog', 'Task 1', 'medium', '[]', '00000000-0000-0000-0000-000000000002', 1000, 1000);
    `);

    const db = drizzle(v1Client, { schema });
    await migrate(db, { migrationsFolder: "./migrations" });

    const fkCheck = await v1Client.execute("PRAGMA foreign_key_check;");
    expect(fkCheck.rows.length).toBe(0);

    const schemaRows = await v1Client.execute(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name IN ('principals', 'boards', 'tasks', 'comments', 'resources', 'activities', 'api_keys')",
    );
    const schemaSql = schemaRows.rows.map((r) => String(r.sql)).join("\n");

    // All former agents references should now point to principals.
    expect(schemaSql).not.toContain("REFERENCES \"agents\"");
    expect(schemaSql).toContain("REFERENCES \"principals\"");

    const principalsRows = await v1Client.execute("SELECT id, kind FROM principals");
    expect(principalsRows.rows.length).toBe(2);
    const owner = principalsRows.rows.find((r) => r.id === "00000000-0000-0000-0000-000000000001");
    expect(owner?.kind).toBe("human");

    v1Client.close();
  });

  it("preserves the owner row id through adoption", async () => {
    const v1Client = await createV1Database();
    await v1Client.execute(`
      INSERT INTO agents (id, display_name, kind, role, created_at) VALUES
      ('00000000-0000-0000-0000-000000000001', 'Owner', 'manual', 'owner', 1000);
    `);

    const db = drizzle(v1Client, { schema });
    await migrate(db, { migrationsFolder: "./migrations" });

    const rows = await v1Client.execute("SELECT id FROM principals WHERE role = 'owner'");
    expect(rows.rows[0].id).toBe("00000000-0000-0000-0000-000000000001");

    v1Client.close();
  });

  it("migrates activities with nullable task_id and audit columns", async () => {
    const v1Client = await createV1Database();
    await v1Client.execute(`
      INSERT INTO agents (id, display_name, kind, role, created_at) VALUES
      ('00000000-0000-0000-0000-000000000001', 'Owner', 'manual', 'owner', 1000);
    `);
    await v1Client.execute(`
      INSERT INTO boards (id, name, slug, columns, created_at, updated_at, created_by) VALUES
      ('00000000-0000-0000-0000-000000000010', 'Main', 'main', '[]', 1000, 1000, '00000000-0000-0000-0000-000000000001');
    `);
    await v1Client.execute(`
      INSERT INTO tasks (id, board_id, status, title, priority, tags, created_by, created_at, updated_at) VALUES
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000010', 'backlog', 'Task 1', 'medium', '[]', '00000000-0000-0000-0000-000000000001', 1000, 1000);
    `);
    await v1Client.execute(`
      INSERT INTO activities (id, task_id, actor_id, action, created_at) VALUES
      ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 'created', 1000);
    `);

    const db = drizzle(v1Client, { schema });
    await migrate(db, { migrationsFolder: "./migrations" });

    const rows = await v1Client.execute("SELECT task_id, target_type, target_id FROM activities");
    expect(rows.rows[0].task_id).toBe("00000000-0000-0000-0000-000000000020");
    expect(rows.rows[0].target_type).toBeNull();
    expect(rows.rows[0].target_id).toBeNull();

    v1Client.close();
  });
});
