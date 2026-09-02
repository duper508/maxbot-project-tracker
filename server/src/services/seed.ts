import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { agents, apiKeys, boards } from "../db/schema.js";
import { config } from "../config.js";
import { generateId, now } from "../lib/id.js";
import { hashApiKey } from "../lib/auth.js";
import { DEFAULT_COLUMNS } from "./boards.js";

export async function seedDatabase(): Promise<void> {
  // Owner agent for human UI sessions
  const ownerRows = await db.select().from(agents).where(eq(agents.role, "owner")).limit(1);
  let ownerId = ownerRows[0]?.id;
  if (!ownerId) {
    ownerId = generateId();
    await db.insert(agents).values({
      id: ownerId,
      displayName: "Owner",
      kind: "manual",
      role: "owner",
      metadata: { initials: "OW", color: "#f59e0b" },
      createdAt: now(),
    });
  }

  // Seed API keys from AGENT_API_KEYS env var: role:name:key
  // Example: editor:OpenClaw:oc_xxx,owner:Hexagon:hex_xxx
  if (config.AGENT_API_KEYS) {
    for (const segment of config.AGENT_API_KEYS.split(",")) {
      const [role, name, ...keyParts] = segment.trim().split(":");
      const key = keyParts.join(":");
      if (!role || !name || !key) continue;
      if (role !== "owner" && role !== "editor" && role !== "viewer") continue;

      const agentRows = await db.select().from(agents).where(eq(agents.displayName, name)).limit(1);
      let agentId = agentRows[0]?.id;
      if (!agentId) {
        agentId = generateId();
        await db.insert(agents).values({
          id: agentId,
          displayName: name,
          kind: "openclaw",
          role,
          metadata: { initials: name.slice(0, 2).toUpperCase(), color: "#3b82f6" },
          createdAt: now(),
        });
      }

      const existing = await db.select().from(apiKeys).where(eq(apiKeys.agentId, agentId)).limit(1);
      if (existing.length === 0) {
        await db.insert(apiKeys).values({
          id: generateId(),
          agentId,
          keyHash: hashApiKey(key),
          name: "default",
          role,
          createdAt: now(),
        });
      }
    }
  }

  // Default board
  const boardRows = await db.select().from(boards).limit(1);
  if (boardRows.length === 0) {
    const id = generateId();
    await db.insert(boards).values({
      id,
      name: "Main Board",
      slug: "main",
      columns: DEFAULT_COLUMNS,
      createdAt: now(),
      updatedAt: now(),
      createdBy: ownerId,
    });
  }
}
