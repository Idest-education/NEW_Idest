import { describe, expect, it } from "vitest";
import { MAX_DISPLAY_NAME, validateDisplayName } from "./profile";

describe("validateDisplayName", () => {
  it("accepts a normal name", () => {
    expect(validateDisplayName("Ada Lovelace")).toBeNull();
  });

  it("trims before measuring", () => {
    expect(validateDisplayName("  Ada  ")).toBeNull();
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateDisplayName("")).not.toBeNull();
    expect(validateDisplayName("   ")).not.toBeNull();
  });

  it("rejects a name longer than the limit but accepts one at the limit", () => {
    expect(validateDisplayName("a".repeat(MAX_DISPLAY_NAME))).toBeNull();
    expect(validateDisplayName("a".repeat(MAX_DISPLAY_NAME + 1))).not.toBeNull();
  });
});
