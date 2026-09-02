import { z, OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { config } from "../config.js";
import { nostrEventSchema, verifyNostrEvent } from "../lib/nostr.js";
import { badRequest } from "../lib/errors.js";
import { buildBuzzAction, executeBuzzAction, parseBuzzContent, resolveBuzzAgent } from "../services/buzz-commands.js";

const app = new OpenAPIHono();

// In-memory dedupe cache: event id -> timestamp
const seenEvents = new Map<string, number>();
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

function isDuplicate(eventId: string): boolean {
  const now = Date.now();
  for (const [id, ts] of seenEvents.entries()) {
    if (now - ts > DEDUPE_TTL_MS) seenEvents.delete(id);
  }
  if (seenEvents.has(eventId)) return true;
  seenEvents.set(eventId, now);
  return false;
}

const buzzWebhookRoute = createRoute({
  method: "post",
  path: "/buzz",
  tags: ["Webhooks"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: nostrEventSchema,
        },
      },
    },
  },
  responses: {
    200: { description: "Processed", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
    400: { description: "Bad request", content: { "application/json": { schema: z.object({ error: z.string() }) } } },
  },
});

app.openapi(buzzWebhookRoute, async (c) => {
  const event = c.req.valid("json");

  if (isDuplicate(event.id)) {
    return c.json({ ok: true, note: "duplicate" }, 200);
  }

  if (config.BUZZ_VERIFY_SIGNATURES === "true" && !verifyNostrEvent(event)) {
    throw badRequest("Invalid Nostr signature");
  }

  const agentId = await resolveBuzzAgent(event);
  const mention = config.BUZZ_SERVICE_PUBKEY?.slice(0, 12) ?? "kanban";
  const parse = parseBuzzContent(event.content, mention);
  const action = buildBuzzAction(parse);

  if (action.type === "unknown") {
    return c.json({ ok: false, error: `Unknown action: ${action.raw}` }, 400);
  }

  await executeBuzzAction(agentId, action);
  return c.json({ ok: true }, 200);
});

export default app;
