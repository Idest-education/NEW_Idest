import { afterEach, describe, expect, it, vi } from "vitest";
import type { Answers } from "@repo/feedback-contract";
import {
  bannerVisible,
  clearDraft,
  draftKey,
  errorText,
  exportFilename,
  firstErrorCode,
  forRole,
  initialAnswers,
  parseDraft,
  progress,
  promptAllowedOn,
  readDraft,
  writeDraft,
} from "./feedback";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("promptAllowedOn", () => {
  it.each([
    ["/teacher", true],
    ["/teacher/submissions", true],
    ["/teacher/classes/abc", true],
    ["/help", true],
    ["/feedback", false],
    ["/feedback/anything", false],
    ["/teacher/submissions/9b1c", false],
    ["/teacher/submissions/9b1c/extra", false],
    [null, false],
  ])("%s → %s", (pathname, expected) => {
    expect(promptAllowedOn(pathname)).toBe(expected);
  });
});

describe("drafts", () => {
  it("keys drafts by instrument version and user", () => {
    expect(draftKey(1, "user-1")).toBe("idest.feedback.draft.v1.user-1");
  });

  it.each([
    null,
    "",
    "not json",
    "[]",
    '{"answers":{}}',
    '{"savedAt":"yesterday","answers":{}}',
    '{"savedAt":"2026-09-28T00:00:00Z","answers":[1]}',
  ])("ignores the unusable draft %j", (raw) => {
    expect(parseDraft(raw)).toBeNull();
  });

  it("keeps only number and string values from a draft", () => {
    expect(
      parseDraft('{"savedAt":"2026-09-28T00:00:00Z","answers":{"ux1":4,"open_like":"hay","bad":{"x":1},"n":null}}'),
    ).toEqual({ savedAt: "2026-09-28T00:00:00Z", answers: { ux1: 4, open_like: "hay" } });
  });

  it("reads, writes and clears through localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    });

    writeDraft("k", { ux1: 4 }, new Date("2026-09-28T03:00:00Z"));
    expect(readDraft("k")).toEqual({ savedAt: "2026-09-28T03:00:00.000Z", answers: { ux1: 4 } });
    clearDraft("k");
    expect(readDraft("k")).toBeNull();
  });

  it("survives a browser that throws on storage access", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(readDraft("k")).toBeNull();
    expect(() => writeDraft("k", { ux1: 4 })).not.toThrow();
    expect(() => clearDraft("k")).not.toThrow();
  });
});

describe("initialAnswers", () => {
  const response = { answers: { ux1: 2 } as Answers, updatedAt: "2026-09-28T02:00:00.000Z" };

  it("uses the saved response when there is no draft", () => {
    expect(initialAnswers("teacher", response, null)).toEqual({ answers: { ux1: 2 }, fromDraft: false });
  });

  it("prefers a draft saved after the response", () => {
    const draft = { savedAt: "2026-09-28T03:00:00.000Z", answers: { ux1: 5 } };
    expect(initialAnswers("teacher", response, draft)).toEqual({ answers: { ux1: 5 }, fromDraft: true });
  });

  it("ignores a draft older than the response", () => {
    const draft = { savedAt: "2026-09-28T01:00:00.000Z", answers: { ux1: 5 } };
    expect(initialAnswers("teacher", response, draft)).toEqual({ answers: { ux1: 2 }, fromDraft: false });
  });

  it("drops codes the role never sees, so a stale draft cannot block submit", () => {
    const draft = { savedAt: "2026-09-28T03:00:00.000Z", answers: { ux1: 5, aiq1: 3, sus1: 4 } };
    expect(initialAnswers("student", null, draft).answers).toEqual({ ux1: 5 });
    expect(forRole("teacher", { aiq1: 3, fq1: 2 })).toEqual({ aiq1: 3 });
  });
});

describe("progress and errors", () => {
  it("counts answered required items only", () => {
    expect(progress("student", {})).toEqual({ answered: 0, total: 18 });
    expect(progress("teacher", { ux1: 4, open_like: "x", nps: 0 })).toEqual({ answered: 2, total: 27 });
  });

  it("finds the first failing item in questionnaire order", () => {
    expect(
      firstErrorCode("teacher", [
        { code: "nps", reason: "required" },
        { code: "ux2", reason: "range" },
      ]),
    ).toBe("ux2");
    expect(firstErrorCode("teacher", [{ code: "", reason: "type" }])).toBeNull();
  });

  it("explains every error reason in Vietnamese", () => {
    expect(errorText("required")).toBe("Chưa trả lời");
    expect(errorText("too_long")).toBe("Quá 2000 ký tự");
    expect(errorText("range")).toBe("Giá trị không hợp lệ");
  });

  it("names export files by UTC date", () => {
    expect(exportFilename("sps", new Date("2026-09-28T23:30:00Z"))).toBe("feedback-2026-09-28.sps");
  });
});

describe("bannerVisible", () => {
  const base = { role: "student" as const, instrumentVersion: 1, gradedCount: null, prompt: false };
  const response = { instrumentVersion: 1, answers: {}, editCount: 0, createdAt: "a", updatedAt: "b" };

  it("shows the survey banner until the user has submitted", () => {
    expect(bannerVisible({ ...base, response: null })).toBe(true);
    expect(bannerVisible({ ...base, response })).toBe(false);
  });

  it("stays hidden while the state is loading or failed", () => {
    expect(bannerVisible(null)).toBe(false);
  });
});
