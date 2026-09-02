import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  kind: text("kind", {
    enum: ["buzz", "openclaw", "claude", "codex", "manual"],
  }).notNull(),
  externalId: text("external_id"),
  role: text("role", { enum: ["owner", "editor", "viewer"] })
    .notNull()
    .default("editor"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "cascade" }),
  keyHash: text("key_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "editor", "viewer"] })
    .notNull()
    .default("editor"),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const boards = sqliteTable("boards", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  columns: text("columns", { mode: "json" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => agents.id, { onDelete: "restrict" }),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  boardId: text("board_id")
    .notNull()
    .references(() => boards.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority", { enum: ["low", "medium", "high", "urgent"] })
    .notNull()
    .default("medium"),
  tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default([]),
  assigneeId: text("assignee_id").references(() => agents.id, {
    onDelete: "set null",
  }),
  createdBy: text("created_by")
    .notNull()
    .references(() => agents.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  closedAt: integer("closed_at", { mode: "timestamp_ms" }),
  dueDate: integer("due_date", { mode: "timestamp_ms" }),
});

export const comments = sqliteTable("comments", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id, { onDelete: "restrict" }),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const resources = sqliteTable("resources", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: [
      "buzz-message",
      "openclaw-artifact",
      "github-pr",
      "github-issue",
      "doc",
      "url",
      "note",
    ],
  }).notNull(),
  source: text("source"),
  properties: text("properties", { mode: "json" }).$type<Record<string, unknown>>(),
  url: text("url"),
  addedBy: text("added_by")
    .notNull()
    .references(() => agents.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => agents.id, { onDelete: "restrict" }),
  action: text("action", {
    enum: [
      "created",
      "moved",
      "closed",
      "reopened",
      "assigned",
      "commented",
      "resource_added",
      "updated",
    ],
  }).notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const boardsRelations = relations(boards, ({ many, one }) => ({
  tasks: many(tasks),
  creator: one(agents, { fields: [boards.createdBy], references: [agents.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  board: one(boards, { fields: [tasks.boardId], references: [boards.id] }),
  assignee: one(agents, { fields: [tasks.assigneeId], references: [agents.id] }),
  creator: one(agents, { fields: [tasks.createdBy], references: [agents.id] }),
  comments: many(comments),
  resources: many(resources),
  activities: many(activities),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  task: one(tasks, { fields: [comments.taskId], references: [tasks.id] }),
  agent: one(agents, { fields: [comments.agentId], references: [agents.id] }),
}));

export const resourcesRelations = relations(resources, ({ one }) => ({
  task: one(tasks, { fields: [resources.taskId], references: [tasks.id] }),
  agent: one(agents, { fields: [resources.addedBy], references: [agents.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  task: one(tasks, { fields: [activities.taskId], references: [tasks.id] }),
  actor: one(agents, { fields: [activities.actorId], references: [agents.id] }),
}));

export const agentsRelations = relations(agents, ({ many }) => ({
  apiKeys: many(apiKeys),
}));

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type Resource = typeof resources.$inferSelect;
export type NewResource = typeof resources.$inferInsert;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
