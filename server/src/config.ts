import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  SQLITE_PATH: z.string().default("file:./data/kanban.db"),
  APP_SECRET: z.string().length(64).regex(/^[0-9a-f]+$/i, "APP_SECRET must be 64 hex characters"),
  // Legacy v1 credentials, consumed once during first migration/seed and then ignored.
  OWNER_TOKEN: z.string().optional(),
  AGENT_API_KEYS: z.string().optional(),
  // Deprecated v1 process config; kept as a runtime fallback while settings migrate to the DB.
  BUZZ_RELAY_URL: z.string().optional(),
  BUZZ_SERVICE_PUBKEY: z.string().optional(),
  BUZZ_VERIFY_SIGNATURES: z.enum(["true", "false"]).default("true"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  return parsed.data;
}

export const config = loadEnv();
