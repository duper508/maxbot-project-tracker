import { integer, sqliteTable, text, blob } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

export const principals = sqliteTable("principals", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  kind: text("kind", {
    enum: ["buzz", "openclaw", "claude", "codex", "manual", "human"],
  }).notNull(),
  externalId: text("external_id"),
  role: text("role", { enum: ["owner", "editor", "viewer"] })
    .notNull()
    .default("editor"),
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  status: text("status", { enum: ["active", "disabled"] })
    .notNull()
    .default("active"),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
  passwordChangedAt: integer("password_changed_at", { mode: "timestamp_ms" }),
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(false),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  principalId: text("principal_id")
    .notNull()
    .references(() => principals.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull().unique(),
  keyHash: text("key_hash").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => principals.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
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
    .references(() => principals.id, { onDelete: "restrict" }),
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
  assigneeId: text("assignee_id").references(() => principals.id, {
    onDelete: "set null",
  }),
  createdBy: text("created_by")
    .notNull()
    .references(() => principals.id, { onDelete: "restrict" }),
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
    .references(() => principals.id, { onDelete: "restrict" }),
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
    .references(() => principals.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(),
  taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => principals.id, { onDelete: "restrict" }),
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
      "principal_created",
      "principal_updated",
      "principal_disabled",
      "key_created",
      "key_rotated",
      "key_revoked",
      "setting_updated",
      "login_succeeded",
      "login_failed",
      "password_changed",
    ],
  }).notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  valueEncrypted: blob("value_encrypted"),
  isSecret: integer("is_secret", { mode: "boolean" }).notNull().default(false),
  updatedBy: text("updated_by").references(() => principals.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const boardsRelations = relations(boards, ({ many, one }) => ({
  tasks: many(tasks),
  creator: one(principals, { fields: [boards.createdBy], references: [principals.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  board: one(boards, { fields: [tasks.boardId], references: [boards.id] }),
  assignee: one(principals, { fields: [tasks.assigneeId], references: [principals.id] }),
  creator: one(principals, { fields: [tasks.createdBy], references: [principals.id] }),
  comments: many(comments),
  resources: many(resources),
  activities: many(activities),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  task: one(tasks, { fields: [comments.taskId], references: [tasks.id] }),
  agent: one(principals, { fields: [comments.agentId], references: [principals.id] }),
}));

export const resourcesRelations = relations(resources, ({ one }) => ({
  task: one(tasks, { fields: [resources.taskId], references: [tasks.id] }),
  agent: one(principals, { fields: [resources.addedBy], references: [principals.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  task: one(tasks, { fields: [activities.taskId], references: [tasks.id] }),
  actor: one(principals, { fields: [activities.actorId], references: [principals.id] }),
}));

export const principalsRelations = relations(principals, ({ many }) => ({
  apiKeys: many(apiKeys),
}));

export type Principal = typeof principals.$inferSelect;
export type NewPrincipal = typeof principals.$inferInsert;
export type Agent = Principal;
export type NewAgent = NewPrincipal;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
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
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
