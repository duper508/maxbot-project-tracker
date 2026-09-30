import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createServer, type Server } from "node:net";
import { migrate } from "drizzle-orm/libsql/migrator";
import { config } from "../config.js";
import { db, resetDatabase } from "../db/index.js";
import { activities, boards, principals, tasks } from "../db/schema.js";
import { notifyTaskAssignee } from "./notifications.js";

const actorId = "00000000-0000-0000-0000-000000000001";
const recipientId = "00000000-0000-0000-0000-000000000002";
const taskId = "00000000-0000-0000-0000-000000000003";

describe("task notifications", () => {
  const originalConfig = { ...config };

  beforeEach(async () => {
    await resetDatabase(":memory:");
    await migrate(db, { migrationsFolder: "./migrations" });
    Object.assign(config, originalConfig, {
      EMAIL_PROVIDER: "none",
      EMAIL_FROM_ADDRESS: undefined,
      EMAIL_FROM_NAME: undefined,
      EMAIL_SMTP_HOST: undefined,
      EMAIL_SMTP_PORT: undefined,
      EMAIL_SMTP_USER: undefined,
      EMAIL_SMTP_PASSWORD: undefined,
      EMAIL_SMTP_TLS: "starttls",
      EMAIL_MCP_ENDPOINT: undefined,
      EMAIL_MCP_ACCOUNT_ID: undefined,
      EMAIL_MCP_TOKEN: undefined,
    });

    const createdAt = new Date();
    await db.insert(principals).values([
      { id: actorId, displayName: "Build Agent", kind: "codex", role: "editor", createdAt },
      { id: recipientId, displayName: "Owner", kind: "human", role: "owner", email: "owner@example.com", createdAt },
    ]);
    await db.insert(boards).values({
      id: "00000000-0000-0000-0000-000000000004",
      name: "Main",
      slug: "main",
      columns: [{ id: "todo", title: "To do", color: "gray", order: 0 }],
      createdAt,
      updatedAt: createdAt,
      createdBy: actorId,
    });
    await db.insert(tasks).values({
      id: taskId,
      boardId: "00000000-0000-0000-0000-000000000004",
      status: "todo",
      title: "Ship notifications",
      priority: "medium",
      tags: [],
      assigneeId: recipientId,
      createdBy: actorId,
      createdAt,
      updatedAt: createdAt,
    });
  });

  async function task() {
    return (await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1))[0]!;
  }

  async function startSmtpSink(): Promise<{ port: number; messages: string[]; close: () => Promise<void> }> {
    const messages: string[] = [];
    const server: Server = createServer((socket) => {
      let buffer = "";
      let inData = false;
      socket.write("220 localhost ESMTP test sink\r\n");
      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 Message accepted\r\n");
        }
        while (!inData) {
          const end = buffer.indexOf("\r\n");
          if (end === -1) return;
          const command = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (/^EHLO /i.test(command)) socket.write("250-localhost\r\n250 PIPELINING\r\n");
          else if (/^DATA$/i.test(command)) {
            inData = true;
            socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
          } else if (/^QUIT$/i.test(command)) socket.end("221 Bye\r\n");
          else socket.write("250 OK\r\n");
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("SMTP sink did not bind a TCP port");
    return {
      port: address.port,
      messages,
      close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
  }

  it("records a skip when delivery is disabled", async () => {
    await notifyTaskAssignee(await task(), actorId, "assigned");
    const records = await db.select().from(activities).where(eq(activities.taskId, taskId));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ action: "notification_skipped", actorId, targetId: recipientId });
    expect(records[0]?.payload).toMatchObject({ reason: "delivery_disabled" });
  });

  it("uses SMTP and records the attempt and delivery", async () => {
    const sink = await startSmtpSink();
    Object.assign(config, {
      EMAIL_PROVIDER: "smtp",
      EMAIL_FROM_ADDRESS: "kanban@example.com",
      EMAIL_SMTP_HOST: "127.0.0.1",
      EMAIL_SMTP_PORT: sink.port,
      EMAIL_SMTP_TLS: "none",
    });
    try {
      await notifyTaskAssignee(await task(), actorId, "commented");
      expect(sink.messages).toHaveLength(1);
      expect(sink.messages[0]).toContain("To: owner@example.com");
      expect(sink.messages[0]).toContain("New comment");
      const records = await db.select().from(activities).where(eq(activities.taskId, taskId));
      expect(records.map((record) => record.action)).toEqual(["notification_attempted", "notification_sent"]);
    } finally {
      await sink.close();
    }
  });

  it("records a delivery failure without throwing from the task mutation path", async () => {
    Object.assign(config, {
      EMAIL_PROVIDER: "smtp",
      EMAIL_FROM_ADDRESS: "kanban@example.com",
    });

    await notifyTaskAssignee(await task(), actorId, "assigned");

    const records = await db.select().from(activities).where(eq(activities.taskId, taskId));
    expect(records.map((record) => record.action)).toEqual(["notification_attempted", "notification_failed"]);
  });

  it("initializes MCP, parses SSE responses, and records delivery", async () => {
    Object.assign(config, {
      EMAIL_PROVIDER: "mcp",
      EMAIL_FROM_ADDRESS: "kanban@example.com",
      EMAIL_MCP_ENDPOINT: "https://mail.example.com/mcp",
      EMAIL_MCP_ACCOUNT_ID: "account-1",
      EMAIL_MCP_TOKEN: "send-only-token",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n", { status: 200 }))
      .mockResolvedValueOnce(new Response("data: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"isError\":false}}\n\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await notifyTaskAssignee(await task(), actorId, "blocked");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ method: "initialize" });
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({
      method: "tools/call",
      params: { arguments: { account_id: "account-1", to: "owner@example.com" } },
    });
    const records = await db.select().from(activities).where(eq(activities.taskId, taskId));
    expect(records.map((record) => record.action)).toEqual(["notification_attempted", "notification_sent"]);
  });
});
