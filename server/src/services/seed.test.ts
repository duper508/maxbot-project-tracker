import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isPlaceholderKey } from "./seed.js";

describe("isPlaceholderKey", () => {
  it("skips old oc_/hex_ example values", () => {
    expect(isPlaceholderKey("oc_xxx")).toBe(true);
    expect(isPlaceholderKey("hex_xxx")).toBe(true);
  });

  it("skips bzk_example/donotuse values", () => {
    expect(isPlaceholderKey("bzk_exampleaaaaa_donotusereplacegeneratedkeyy")).toBe(true);
    expect(isPlaceholderKey("bzk_anything_donotuse")).toBe(true);
  });

  it("accepts real-looking bzk keys", () => {
    expect(isPlaceholderKey("bzk_rz75ihlkajnp_rwwwl7d7qohupxceerkzt2gbkehtyhch")).toBe(false);
  });
});

// Drift protection for the example keys shipped in .env.example.
//
// The tests above pin the detector against string literals, which is not the same as
// pinning the values an operator actually copies. Nothing else in the suite reads
// .env.example, so without this an edit to the example keys can land green and a fresh
// boot would seed a real principal from a publicly published key.
describe(".env.example AGENT_API_KEYS", () => {
  const envExample = readFileSync(
    fileURLToPath(new URL("../../../.env.example", import.meta.url)),
    "utf8",
  );

  const line = envExample
    .split(/\r?\n/)
    .find((l) => l.startsWith("AGENT_API_KEYS="));

  it("is present in .env.example", () => {
    expect(line).toBeDefined();
  });

  it("ships only keys the seeder will skip", () => {
    const entries = line!.slice("AGENT_API_KEYS=".length).split(",").filter(Boolean);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      // role:Name:key - the key itself never contains a colon.
      const parts = entry.split(":");
      expect(parts).toHaveLength(3);
      const key = parts[2];
      expect(key).not.toBe("");
      expect(isPlaceholderKey(key)).toBe(true);
    }
  });
});
