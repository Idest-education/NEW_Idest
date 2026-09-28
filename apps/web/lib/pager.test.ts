import { describe, expect, it } from "vitest";
import { pagerSlots } from "./pager";

describe("pagerSlots", () => {
  it("lists every page when there are few", () => {
    expect(pagerSlots(1, 1)).toEqual([1]);
    expect(pagerSlots(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps the first pages and the last one near the start", () => {
    expect(pagerSlots(1, 10)).toEqual([1, 2, 3, 4, "gap", 10]);
  });

  it("keeps neighbours of the current page in the middle", () => {
    expect(pagerSlots(6, 12)).toEqual([1, "gap", 5, 6, 7, "gap", 12]);
  });

  it("keeps the last pages and the first one near the end", () => {
    expect(pagerSlots(10, 10)).toEqual([1, "gap", 7, 8, 9, 10]);
  });

  it("shows a lone skipped page as a number, not a gap", () => {
    expect(pagerSlots(4, 10)).toEqual([1, 2, 3, 4, 5, "gap", 10]);
  });
});
