import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

const sqlitePath = process.env.SQLITE_PATH ?? "file:./data/kanban.db";

export const client = createClient({ url: sqlitePath });
export const db = drizzle(client, { schema });

export type Database = typeof db;
