import nodemailer from "nodemailer";
import { config } from "../config.js";
import type { Principal, Task } from "../db/schema.js";
import { createActivity } from "./activities.js";
import { getPrincipal } from "./agents.js";

const DELIVERY_TIMEOUT_MS = 10_000;

type NotificationKind = "assigned" | "commented" | "blocked";

interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

function configuredEmail(): { provider: "smtp" | "mcp"; from: string; fromName?: string } | null {
  if (config.EMAIL_PROVIDER === "none") return null;
  if (!config.EMAIL_FROM_ADDRESS) throw new Error("EMAIL_FROM_ADDRESS is required when email is enabled");
  return { provider: config.EMAIL_PROVIDER, from: config.EMAIL_FROM_ADDRESS, fromName: config.EMAIL_FROM_NAME };
}

function formatFrom(from: string, name?: string): string {
  return name ? `${name} <${from}>` : from;
}

async function sendSmtp(message: EmailMessage): Promise<void> {
  if (!config.EMAIL_SMTP_HOST || !config.EMAIL_SMTP_PORT) {
    throw new Error("EMAIL_SMTP_HOST and EMAIL_SMTP_PORT are required for SMTP delivery");
  }
  const transport = nodemailer.createTransport({
    host: config.EMAIL_SMTP_HOST,
    port: config.EMAIL_SMTP_PORT,
    secure: config.EMAIL_SMTP_TLS === "implicit",
    requireTLS: config.EMAIL_SMTP_TLS === "starttls",
    ignoreTLS: config.EMAIL_SMTP_TLS === "none",
    auth: config.EMAIL_SMTP_USER ? { user: config.EMAIL_SMTP_USER, pass: config.EMAIL_SMTP_PASSWORD } : undefined,
    connectionTimeout: DELIVERY_TIMEOUT_MS,
    socketTimeout: DELIVERY_TIMEOUT_MS,
  });
  await transport.sendMail({
    from: formatFrom(config.EMAIL_FROM_ADDRESS!, config.EMAIL_FROM_NAME),
    to: message.to,
    subject: message.subject,
    text: message.body,
  });
}

async function parseSseJson(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) throw new Error(`MCP request failed with HTTP ${response.status}`);
  const payload = await response.text();
  const data = payload
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data) throw new Error("MCP response did not include an SSE data frame");
  const parsed: unknown = JSON.parse(data);
  if (!parsed || typeof parsed !== "object") throw new Error("MCP response was not a JSON object");
  return parsed as Record<string, unknown>;
}

async function mcpRequest(
  id: number,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<{ body: Record<string, unknown>; sessionId?: string }> {
  if (!config.EMAIL_MCP_ENDPOINT || !config.EMAIL_MCP_TOKEN) {
    throw new Error("EMAIL_MCP_ENDPOINT and EMAIL_MCP_TOKEN are required for MCP delivery");
  }
  const response = await fetch(config.EMAIL_MCP_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.EMAIL_MCP_TOKEN}`,
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });
  const body = await parseSseJson(response);
  if (body.error) throw new Error("MCP returned a JSON-RPC error");
  return { body, sessionId: response.headers.get("Mcp-Session-Id") ?? undefined };
}

async function sendMcp(message: EmailMessage): Promise<void> {
  if (!config.EMAIL_MCP_ACCOUNT_ID) throw new Error("EMAIL_MCP_ACCOUNT_ID is required for MCP delivery");
  const initialized = await mcpRequest(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "buzz-kanban", version: "0.0.0" },
  });
  const result = await mcpRequest(2, "tools/call", {
    name: "email_send_message",
    arguments: {
      account_id: config.EMAIL_MCP_ACCOUNT_ID,
      to: message.to,
      subject: message.subject,
      body: message.body,
    },
  }, initialized.sessionId);
  const toolResult = result.body.result as { isError?: unknown } | undefined;
  if (!toolResult) throw new Error("MCP tool response did not include a result");
  if (toolResult?.isError === true) throw new Error("MCP email tool returned an error");
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const email = configuredEmail();
  if (!email) throw new Error("Email delivery is disabled");
  if (email.provider === "smtp") return sendSmtp(message);
  return sendMcp(message);
}

function eventText(kind: NotificationKind, task: Task, actor: Principal): { subject: string; body: string } {
  const action = kind === "assigned" ? "assigned you to" : kind === "commented" ? "commented on" : "moved";
  const suffix = kind === "blocked" ? " into a blocked column" : "";
  return {
    subject: `[Buzz Kanban] ${kind === "assigned" ? "Assigned" : kind === "commented" ? "New comment" : "Blocked"}: ${task.title}`,
    body: `${actor.displayName} ${action} task “${task.title}”${suffix}.`,
  };
}

async function record(taskId: string, actorId: string, action: "notification_attempted" | "notification_sent" | "notification_failed" | "notification_skipped", recipientId: string | null, payload: Record<string, unknown>): Promise<void> {
  await createActivity({ taskId, actorId, action, targetType: recipientId ? "principal" : "notification", targetId: recipientId, payload });
}

/** Delivery failures are recorded and never undo the board mutation that triggered them. */
export async function notifyTaskAssignee(task: Task, actorId: string, kind: NotificationKind): Promise<void> {
  if (!task.assigneeId) {
    await record(task.id, actorId, "notification_skipped", null, { kind, reason: "no_assignee" });
    return;
  }
  if (task.assigneeId === actorId) {
    await record(task.id, actorId, "notification_skipped", task.assigneeId, { kind, reason: "self_action" });
    return;
  }

  const [recipient, actor] = await Promise.all([getPrincipal(task.assigneeId), getPrincipal(actorId)]);
  if (recipient.kind !== "human" || !recipient.email) {
    await record(task.id, actorId, "notification_skipped", recipient.id, { kind, reason: "recipient_has_no_email" });
    return;
  }
  if (config.EMAIL_PROVIDER === "none") {
    await record(task.id, actorId, "notification_skipped", recipient.id, { kind, reason: "delivery_disabled" });
    return;
  }

  await record(task.id, actorId, "notification_attempted", recipient.id, { kind, provider: config.EMAIL_PROVIDER });
  const content = eventText(kind, task, actor);
  try {
    await sendEmail({ to: recipient.email, ...content });
    await record(task.id, actorId, "notification_sent", recipient.id, { kind, provider: config.EMAIL_PROVIDER });
  } catch (error) {
    await record(task.id, actorId, "notification_failed", recipient.id, { kind, provider: config.EMAIL_PROVIDER });
    console.error("Task notification delivery failed", { taskId: task.id, recipientId: recipient.id, kind, error: error instanceof Error ? error.message : "unknown" });
  }
}
