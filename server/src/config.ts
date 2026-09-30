import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("0.0.0.0"),
  SQLITE_PATH: z.string().default("file:./data/kanban.db"),
  APP_SECRET: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/i, "APP_SECRET must be 64 hex characters")
    .refine(
      (s) => !/^0{64}$/i.test(s) && !/^([0-9a-f])\1{63}$/i.test(s),
      "APP_SECRET appears to be a placeholder or weak value",
    ),
  // Optional CIDR of a trusted reverse proxy. When the socket peer address is inside this
  // range, X-Forwarded-For is honored; otherwise it is ignored to prevent client spoofing.
  TRUSTED_PROXY_CIDR: z.string().optional(),
  // Legacy v1 credentials, consumed once during first migration/seed and then ignored.
  OWNER_TOKEN: z.string().optional(),
  AGENT_API_KEYS: z.string().optional(),
  // Deprecated v1 process config; kept as a runtime fallback while settings migrate to the DB.
  BUZZ_RELAY_URL: z.string().optional(),
  BUZZ_SERVICE_PUBKEY: z.string().optional(),
  BUZZ_VERIFY_SIGNATURES: z.enum(["true", "false"]).default("true"),
  // Email is disabled unless explicitly configured. SMTP is the portable
  // default provider; MCP supports the instance's existing email service.
  EMAIL_PROVIDER: z.enum(["none", "smtp", "mcp"]).default("none"),
  EMAIL_FROM_ADDRESS: z.string().email().optional(),
  EMAIL_FROM_NAME: z.string().min(1).optional(),
  EMAIL_SMTP_HOST: z.string().min(1).optional(),
  EMAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  EMAIL_SMTP_USER: z.string().optional(),
  EMAIL_SMTP_PASSWORD: z.string().optional(),
  EMAIL_SMTP_TLS: z.enum(["starttls", "implicit", "none"]).default("starttls"),
  EMAIL_MCP_ENDPOINT: z.string().url().optional(),
  EMAIL_MCP_ACCOUNT_ID: z.string().min(1).optional(),
  EMAIL_MCP_TOKEN: z.string().min(1).optional(),
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
