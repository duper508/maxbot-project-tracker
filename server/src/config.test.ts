import { describe, it, expect } from "vitest";
import { envSchema } from "./config.js";

describe("envSchema", () => {
  const base = {
    NODE_ENV: "production",
    PORT: "3000",
    HOST: "0.0.0.0",
    SQLITE_PATH: "file:./data/kanban.db",
    APP_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    BUZZ_VERIFY_SIGNATURES: "true",
  };

  it("accepts a valid 64-hex APP_SECRET", () => {
    const result = envSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects an all-zero APP_SECRET", () => {
    const result = envSchema.safeParse({
      ...base,
      APP_SECRET: "0".repeat(64),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a repeated-character APP_SECRET", () => {
    const result = envSchema.safeParse({
      ...base,
      APP_SECRET: "a".repeat(64),
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-hex APP_SECRET", () => {
    const result = envSchema.safeParse({
      ...base,
      APP_SECRET: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a short APP_SECRET", () => {
    const result = envSchema.safeParse({
      ...base,
      APP_SECRET: "0123",
    });
    expect(result.success).toBe(false);
  });
});
