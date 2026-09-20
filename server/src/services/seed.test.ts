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
