import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

const defaultSqlitePath = process.env.SQLITE_PATH ?? "file:./data/kanban.db";

function buildDatabase(url: string): { client: Client; db: LibSQLDatabase<typeof schema> } {
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { client, db };
}

let state = buildDatabase(defaultSqlitePath);

export let client: Client = state.client;
export let db: LibSQLDatabase<typeof schema> = state.db;

// SQLite leaves foreign keys off by default; the A1 migration renames agents ->
// principals and re-creates referencing tables, so enforcement must be on.
await client.execute("PRAGMA foreign_keys = ON;");

export type Database = typeof db;

/** Replace the live database connection. Used by tests for isolation. */
export async function resetDatabase(url: string): Promise<void> {
  state = buildDatabase(url);
  client = state.client;
  db = state.db;
  await client.execute("PRAGMA foreign_keys = ON;");
}
