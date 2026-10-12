import { describe, expect, it } from "vitest";
import { bandTone, bandWord, groupByDate, markPhrases, overallFrom, pageOf } from "./format";

const s = (a: number, b: number, c: number, d: number) => ({
  task_response: a,
  coherence_cohesion: b,
  lexical_resource: c,
  grammatical_range_accuracy: d,
});

describe("overallFrom", () => {
  it("rounds the mean to the nearest half band, .25 and .75 rounding up", () => {
    expect(overallFrom(s(6, 6, 6, 6))).toBe(6);
    expect(overallFrom(s(6, 6, 6, 7))).toBe(6.5); // 6.25
    expect(overallFrom(s(6, 7, 7, 7))).toBe(7); // 6.75
    expect(overallFrom(s(6, 6, 6, 6.5))).toBe(6); // 6.125
  });
});

describe("groupByDate", () => {
  it("groups by calendar day relative to now, in input order", () => {
    const now = new Date(2026, 9, 11, 9, 0);
    const at = (d: number, h = 12) => new Date(2026, 9, d, h).toISOString();
    const groups = groupByDate([at(11, 8), at(10, 23), at(8), at(1), at(11, 1)], (x) => x, now);
    expect(groups.map((g) => [g.label, g.items.length])).toEqual([
      ["Today", 2],
      ["Yesterday", 1],
      ["Previous 7 days", 1],
      ["Earlier", 1],
    ]);
  });
});

describe("markPhrases", () => {
  it("marks each phrase once, in text order, and keeps every character", () => {
    const text = "He go to school. He go home.";
    const parts = markPhrases(text, ["He go home", "He go", "missing"]);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.mark !== null).map((p) => [p.text, p.mark])).toEqual([
      ["He go", 1],
      ["He go home", 0],
    ]);
  });
});

describe("bandTone and bandWord", () => {
  it("groups bands into four tones at the planned edges", () => {
    expect([4, 5, 5.5, 6, 6.5, 7, 7.5, 9].map(bandTone)).toEqual(["low", "low", "mid", "mid", "good", "good", "great", "great"]);
  });

  it("names the whole band a score falls in", () => {
    expect(bandWord(6.5)).toBe("Competent user");
    expect(bandWord(7)).toBe("Good user");
    expect(bandWord(9)).toBe("Expert user");
    expect(bandWord(0)).toBe("Did not attempt");
  });
});

describe("pageOf", () => {
  it("cuts 15 per page and clamps the page into range", () => {
    const items = Array.from({ length: 31 }, (_, i) => i);
    expect(pageOf(items, 1)).toEqual({ items: items.slice(0, 15), page: 1, totalPages: 3 });
    expect(pageOf(items, 3).items).toEqual([30]);
    expect(pageOf(items, 9).page).toBe(3);
    expect(pageOf([], 1)).toEqual({ items: [], page: 1, totalPages: 1 });
  });
});
