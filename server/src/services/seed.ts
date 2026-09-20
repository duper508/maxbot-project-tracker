import { eq } from "drizzle-orm";
import { db, client } from "../db/index.js";
import { principals, apiKeys, boards } from "../db/schema.js";
import { config } from "../config.js";
import { generateId, now } from "../lib/id.js";
import { hashApiKeySecret, parseApiKey } from "../lib/auth.js";
import { DEFAULT_COLUMNS } from "./boards.js";

const PLACEHOLDER_PATTERNS = [
  /^oc_xxx/i,
  /^hex_xxx/i,
  /^xxx_/i,
  /^placeholder/i,
  /^example/i,
  /bzk_example/i,
  /donotuse/i,
];

export function isPlaceholderKey(key: string): boolean {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(key));
}

export async function seedDatabase(): Promise<void> {
  // Owner principal for human UI sessions. Created only if no owner row exists.
  const ownerRows = await db.select().from(principals).where(eq(principals.role, "owner")).limit(1);
  let ownerId = ownerRows[0]?.id;
  if (!ownerId) {
    ownerId = generateId();
    await db.insert(principals).values({
      id: ownerId,
      displayName: "Owner",
      kind: "human",
      role: "owner",
      metadata: { initials: "OW", color: "#f59e0b" },
      createdAt: now(),
    });
  }

  // Import agent API keys from the legacy AGENT_API_KEYS env var once.
  // Format: role:name:key (e.g. editor:OpenClaw:oc_abc123...,owner:Hexagon:hex_...)
  if (config.AGENT_API_KEYS) {
    const importedPrincipalIds = new Set<string>();

    for (const segment of config.AGENT_API_KEYS.split(",")) {
      const [role, name, ...keyParts] = segment.trim().split(":");
      const key = keyParts.join(":");
      if (!role || !name || !key) continue;
      if (role !== "owner" && role !== "editor" && role !== "viewer") continue;
      if (isPlaceholderKey(key)) {
        console.warn(`Skipping placeholder AGENT_API_KEYS entry for ${name}`);
        continue;
      }

      const principalRows = await db
        .select()
        .from(principals)
        .where(eq(principals.displayName, name))
        .limit(1);
      let principalId = principalRows[0]?.id;
      if (!principalId) {
        principalId = generateId();
        await db.insert(principals).values({
          id: principalId,
          displayName: name,
          kind: "openclaw",
          role,
          metadata: { initials: name.slice(0, 2).toUpperCase(), color: "#3b82f6" },
          createdAt: now(),
        });
      }

      // Only import once per principal per boot to avoid duplicate keys.
      if (importedPrincipalIds.has(principalId)) continue;
      importedPrincipalIds.add(principalId);

      const existing = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.principalId, principalId))
        .limit(1);
      if (existing.length === 0) {
        const parsed = parseApiKey(key);
        if (!parsed) {
          console.warn(
            `Skipping AGENT_API_KEYS entry for ${name}: key is not in bzk_<prefix>_<secret> format`,
          );
          continue;
        }
        await db.insert(apiKeys).values({
          id: generateId(),
          principalId,
          name: "default",
          prefix: parsed.prefix,
          keyHash: hashApiKeySecret(parsed.secret),
          createdBy: ownerId,
          createdAt: now(),
        });
        console.log(
          `Imported API key for ${name} (principal ${principalId}): prefix bzk_${parsed.prefix}_...`,
        );
      }
    }

    // Log legacy api_keys rows whose principal did not receive a new key. These
    // rows are dead: their bcrypt hash cannot be converted to SHA-256.
    try {
      const legacyRows = await client.execute("SELECT agent_id, name FROM `_legacy_api_keys`");
      for (const row of legacyRows.rows) {
        if (!importedPrincipalIds.has(String(row.agent_id))) {
          console.warn(
            `Legacy API key no longer traces to AGENT_API_KEYS: principal ${row.agent_id}, name "${row.name}"`,
          );
        }
      }
    } catch {
      // _legacy_api_keys only exists on migrated instances; ignore absence.
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
