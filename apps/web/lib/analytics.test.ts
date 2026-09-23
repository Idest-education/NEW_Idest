import { describe, expect, it } from "vitest";
import { windowQuery } from "./analytics";

describe("windowQuery", () => {
  it("is empty when no window is given", () => {
    expect(windowQuery({})).toBe("");
  });

  it("carries only the bounds that were given", () => {
    expect(windowQuery({ from: "2026-09-01" })).toBe("?from=2026-09-01");
    expect(windowQuery({ to: "2026-09-30" })).toBe("?to=2026-09-30");
  });

  it("carries both bounds in a stable order", () => {
    expect(windowQuery({ from: "2026-09-01", to: "2026-09-30" })).toBe(
      "?from=2026-09-01&to=2026-09-30",
    );
  });

  it("encodes a bound that contains a colon", () => {
    expect(windowQuery({ from: "2026-09-01T00:00:00Z" })).toBe(
      "?from=2026-09-01T00%3A00%3A00Z",
    );
  });
});
