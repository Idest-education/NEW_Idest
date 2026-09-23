import { describe, expect, it } from "vitest";
import {
  NO_SCORE_CHANGE,
  REASON_CODES,
  REASON_LABEL,
  canSubmitBatch,
  describeScoreChanges,
  toggle,
} from "./reason-codes";

describe("REASON_CODES", () => {
  it("matches the server's RevisionReason enum exactly", () => {
    expect(REASON_CODES).toEqual([
      "ai_too_generous",
      "ai_too_harsh",
      "ai_missed_off_topic",
      "ai_wrong_criterion",
      "ai_feedback_inaccurate",
      "ai_unavailable",
      "minor_polish",
      "other",
    ]);
  });

  it("gives every code a non-empty label", () => {
    for (const code of REASON_CODES) {
      expect(REASON_LABEL[code].trim().length).toBeGreaterThan(0);
    }
  });

  it("has a sentence for a revision that moved no score", () => {
    expect(NO_SCORE_CHANGE.trim().length).toBeGreaterThan(0);
  });
});

describe("describeScoreChanges", () => {
  it("abbreviates the criterion and prints both bands to one decimal", () => {
    expect(
      describeScoreChanges([
        { criterion: "task_response", from: 7, to: 6.5 },
        { criterion: "overall", from: 6.5, to: 6 },
      ]),
    ).toEqual(["TR 7.0 → 6.5", "Overall 6.5 → 6.0"]);
  });

  it("prints an em dash for a missing end, because the server drops undefined sides", () => {
    expect(describeScoreChanges([{ criterion: "lexical_resource", to: 6 }])).toEqual([
      "LR — → 6.0",
    ]);
  });

  it("falls back to the raw key for a criterion it does not know", () => {
    expect(describeScoreChanges([{ criterion: "handwriting", from: 5, to: 6 }])).toEqual([
      "handwriting 5.0 → 6.0",
    ]);
  });

  it("returns nothing when the revision changed no score at all", () => {
    expect(describeScoreChanges([])).toEqual([]);
    expect(describeScoreChanges(undefined)).toEqual([]);
    expect(describeScoreChanges(null)).toEqual([]);
  });
});

describe("toggle", () => {
  it("removes a value that is already selected", () => {
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });

  it("adds a value that is not selected yet", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("canSubmitBatch", () => {
  it("refuses a batch with nothing checked", () => {
    expect(canSubmitBatch([], ["other"])).toBe(false);
  });

  it("refuses a batch with no reason picked", () => {
    expect(canSubmitBatch(["rev-1"], [])).toBe(false);
  });

  it("accepts one revision with one reason", () => {
    expect(canSubmitBatch(["rev-1"], ["minor_polish"])).toBe(true);
  });
});
