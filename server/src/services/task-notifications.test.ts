import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "drizzle-orm/libsql/migrator";
import { db, resetDatabase } from "../db/index.js";
import { activities, boards, principals, tasks } from "../db/schema.js";
import { assignTask, moveTask } from "./tasks.js";
import { createComment } from "./comments.js";
import { config } from "../config.js";

const actorId = "00000000-0000-0000-0000-000000000001";
const recipientId = "00000000-0000-0000-0000-000000000002";
const boardId = "00000000-0000-0000-0000-000000000003";
const taskId = "00000000-0000-0000-0000-000000000004";

describe("task notification triggers", () => {
  beforeEach(async () => {
    await resetDatabase(":memory:");
    await migrate(db, { migrationsFolder: "./migrations" });
    config.EMAIL_PROVIDER = "none";
    const timestamp = new Date();
    await db.insert(principals).values([
      { id: actorId, displayName: "Agent", kind: "codex", role: "editor", createdAt: timestamp },
      { id: recipientId, displayName: "Owner", kind: "human", role: "owner", email: "owner@example.com", createdAt: timestamp },
    ]);
    await db.insert(boards).values({
      id: boardId,
      name: "Main",
      slug: "main",
      columns: [
        { id: "todo", title: "To do", color: "gray", order: 0 },
        { id: "blocked", title: "Blocked", color: "red", order: 1 },
      ],
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy: actorId,
    });
    await db.insert(tasks).values({
      id: taskId,
      boardId,
      status: "todo",
      title: "Notify me",
      priority: "medium",
      tags: [],
      createdBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  it("notifies the assignee for assignment, blocked movement, and another actor's comment", async () => {
    await assignTask(taskId, actorId, recipientId);
    await moveTask(taskId, actorId, "blocked");
    await createComment(taskId, actorId, "Waiting for a decision");

    const rows = await db.select().from(activities);
    const skipped = rows.filter((row) => row.action === "notification_skipped");
    expect(skipped).toHaveLength(3);
    expect(skipped.map((row) => (row.payload as { kind: string }).kind).sort())
      .toEqual(["assigned", "blocked", "commented"]);
    expect(skipped.every((row) => row.targetId === recipientId)).toBe(true);
  });
});
