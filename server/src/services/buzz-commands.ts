import { createTask, closeTask, reopenTask, assignTask } from "./tasks.js";
import { createComment } from "./comments.js";
import { createResource } from "./resources.js";
import { ensureAgent } from "./agents.js";
import { getBoardBySlug, listBoards } from "./boards.js";
import { badRequest, notFound } from "../lib/errors.js";
import type { NostrEvent } from "../lib/nostr.js";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { agents } from "../db/schema.js";

export type BuzzAction =
  | { type: "create_task"; title: string; fields: Record<string, string> }
  | { type: "close_task"; taskId: string }
  | { type: "reopen_task"; taskId: string }
  | { type: "comment_task"; taskId: string; body: string }
  | { type: "assign_task"; taskId: string; assigneeQuery: string }
  | { type: "attach_resource"; taskId: string; fields: Record<string, string> }
  | { type: "unknown"; raw: string };

interface ParseResult {
  action: string;
  positional: string[];
  fields: Record<string, string>;
}

export function parseBuzzContent(content: string, mention: string): ParseResult {
  // Strip the mention and any leading whitespace
  let text = content.replace(new RegExp(`\\s*@${mention}\\b`, "i"), "").trim();

  // Extract quoted strings
  const quoted: string[] = [];
  text = text.replace(/"([^"]*)"/g, (_match, value) => {
    quoted.push(value);
    return `__QUOTED${quoted.length - 1}__`;
  });

  // Extract key=value pairs
  const fields: Record<string, string> = {};
  text = text.replace(/(\w+)=([^\s]+)/g, (_match, key, value) => {
    fields[key] = value;
    return "";
  });

  const tokens = text.split(/\s+/).filter(Boolean);
  const action = tokens.shift() ?? "";

  // Replace quoted placeholders back
  const positional = tokens.map((t) => {
    const match = t.match(/^__QUOTED(\d+)__$/);
    return match ? quoted[Number(match[1])] : t;
  });

  return { action, positional, fields };
}

export async function resolveBuzzAgent(event: NostrEvent): Promise<string> {
  const agent = await ensureAgent({
    displayName: event.pubkey.slice(0, 12),
    kind: "buzz",
    externalId: event.pubkey,
    metadata: { pubkey: event.pubkey },
  });

  // Update display name if we can resolve a profile later; for now keep pubkey prefix
  return agent.id;
}

async function resolveDefaultBoardId(): Promise<string> {
  const boards = await listBoards();
  if (boards.length === 0) throw notFound("Board");
  return boards[0].id;
}

async function resolveBoardId(fields: Record<string, string>): Promise<string> {
  if (fields.board) {
    const board = await getBoardBySlug(fields.board);
    return board.id;
  }
  return resolveDefaultBoardId();
}

async function resolveAssignee(query: string): Promise<string> {
  // Try exact id first
  const byId = await db.select().from(agents).where(eq(agents.id, query)).limit(1);
  if (byId.length > 0) return byId[0].id;

  // Try display name (case-insensitive)
  const byName = await db
    .select()
    .from(agents)
    .where(eq(agents.displayName, query))
    .limit(1);
  if (byName.length > 0) return byName[0].id;

  // Try external id
  const byExternal = await db
    .select()
    .from(agents)
    .where(eq(agents.externalId, query))
    .limit(1);
  if (byExternal.length > 0) return byExternal[0].id;

  throw notFound("Assignee");
}

export async function executeBuzzAction(
  agentId: string,
  action: BuzzAction,
): Promise<unknown> {
  switch (action.type) {
    case "create_task": {
      const boardId = await resolveBoardId(action.fields);
      const priority = action.fields.priority as "low" | "medium" | "high" | "urgent" | undefined;
      return createTask({
        boardId,
        title: action.title,
        description: action.fields.description,
        priority,
        tags: action.fields.tags ? action.fields.tags.split(",") : undefined,
        status: action.fields.status,
        createdBy: agentId,
      });
    }
    case "close_task":
      return closeTask(action.taskId, agentId);
    case "reopen_task":
      return reopenTask(action.taskId, agentId);
    case "comment_task":
      return createComment(action.taskId, agentId, action.body);
    case "assign_task": {
      const assigneeId = await resolveAssignee(action.assigneeQuery);
      return assignTask(action.taskId, agentId, assigneeId);
    }
    case "attach_resource": {
      const type = action.fields.type ?? "note";
      return createResource({
        taskId: action.taskId,
        type: type as import("../db/schema.js").Resource["type"],
        source: action.fields.source,
        url: action.fields.url,
        properties: action.fields,
        addedBy: agentId,
      });
    }
    default:
      throw badRequest("Unknown action");
  }
}

export function buildBuzzAction(parse: ParseResult): BuzzAction {
  const { action, positional, fields } = parse;

  switch (action.toLowerCase()) {
    case "create": {
      const title = positional[0] ?? fields.title;
      if (!title) throw badRequest("Create action requires a title");
      return { type: "create_task", title, fields };
    }
    case "close": {
      const taskId = positional[0];
      if (!taskId) throw badRequest("Close action requires a task id");
      return { type: "close_task", taskId };
    }
    case "reopen": {
      const taskId = positional[0];
      if (!taskId) throw badRequest("Reopen action requires a task id");
      return { type: "reopen_task", taskId };
    }
    case "comment": {
      const taskId = positional[0];
      const body = positional[1] ?? fields.body;
      if (!taskId || !body) throw badRequest("Comment action requires task id and body");
      return { type: "comment_task", taskId, body };
    }
    case "assign": {
      const taskId = positional[0];
      const assigneeQuery = positional[2] ?? fields.to ?? fields.assignee;
      if (!taskId || !assigneeQuery) throw badRequest("Assign action requires task id and assignee");
      return { type: "assign_task", taskId, assigneeQuery };
    }
    case "attach": {
      const taskId = positional[0];
      if (!taskId) throw badRequest("Attach action requires a task id");
      return { type: "attach_resource", taskId, fields };
    }
    default:
      return { type: "unknown", raw: action };
  }
}
