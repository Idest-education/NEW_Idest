import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addClassMember,
  cancelClassInvitation,
  dismissFeedbackPrompt,
  downloadFeedbackExport,
  getFeedback,
  getOnboarding,
  listUntaggedRevisions,
  recordReviewSessionQuietly,
  saveFeedback,
  setOnboardingDismissed,
  submitTicket,
  listTickets,
  listSubmissionsPage,
  tagRevisionsBatch,
} from "./idest";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("recordReviewSessionQuietly", () => {
  it("posts to the review-session endpoint and returns the session", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ recorded: true, sessionId: "s-1" }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await recordReviewSessionQuietly("tok_123", "submission-1");

    expect(result).toEqual({ recorded: true, sessionId: "s-1" });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/submissions\/submission-1\/review-session$/);
    expect(init.method).toBe("POST");
  });

  it("swallows a server error rather than surfacing it to the teacher", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "boom" }, 500)) as unknown as typeof fetch;

    await expect(recordReviewSessionQuietly("tok_123", "submission-1")).resolves.toBeNull();
  });

  it("swallows a network failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError("offline")) as unknown as typeof fetch;

    await expect(recordReviewSessionQuietly(null, "submission-1")).resolves.toBeNull();
  });
});

describe("listUntaggedRevisions", () => {
  it("reads the untagged revisions of one assignment", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse([]));
    globalThis.fetch = spy as unknown as typeof fetch;

    await listUntaggedRevisions("assignment-1", "tok_123");

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/assignments\/assignment-1\/revisions\/untagged$/);
    expect(init.method).toBeUndefined();
  });
});

describe("tagRevisionsBatch", () => {
  it("sends the checked revisions and the picked reason codes as one batch", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ batchId: "batch-1", tagged: 2 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await tagRevisionsBatch("tok_123", {
      revisionIds: ["rev-1", "rev-2"],
      reasonCodes: ["ai_too_generous", "minor_polish"],
      note: "AI rộng tay ở Task Response",
    });

    expect(result).toEqual({ batchId: "batch-1", tagged: 2 });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/revision-reasons\/batch$/);
    expect(JSON.parse(init.body as string)).toEqual({
      revisionIds: ["rev-1", "rev-2"],
      reasonCodes: ["ai_too_generous", "minor_polish"],
      note: "AI rộng tay ở Task Response",
    });
  });
});

describe("submitTicket", () => {
  it("posts the subject, message and images as multipart to the tickets endpoint", async () => {
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "t1" }), { status: 201 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const image = new File(["png"], "shot.png", { type: "image/png" });
    await submitTicket("tok_123", "Không nộp được bài", "Bấm Nộp bài nhưng không có phản hồi.", [image]);

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/support\/tickets$/);
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("subject")).toBe("Không nộp được bài");
    expect(form.get("message")).toBe("Bấm Nộp bài nhưng không có phản hồi.");
    expect(form.getAll("images")).toHaveLength(1);
  });

  it("throws an ApiError carrying the server's message on failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Không gửi được yêu cầu. Thử lại sau." }), { status: 502 }),
      ) as unknown as typeof fetch;

    await expect(submitTicket("tok_123", "x", "y")).rejects.toThrow("Không gửi được yêu cầu. Thử lại sau.");
  });
});

describe("listTickets", () => {
  it("gets the tickets endpoint and returns the rows", async () => {
    const rows = [{ id: "t1", subject: "x" }];
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(listTickets("tok_123")).resolves.toEqual(rows);
    expect(String(spy.mock.calls[0]![0])).toMatch(/\/support\/tickets$/);
  });
});

const onboardingBody = {
  steps: {
    createClass: false,
    inviteStudent: false,
    inviteLink: false,
    createAssignment: false,
    openAssignment: false,
  },
  targetClassId: null,
  dismissedAt: null,
};

describe("getOnboarding", () => {
  it("reads the calling teacher's onboarding status", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse(onboardingBody));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(getOnboarding("tok_123")).resolves.toEqual(onboardingBody);

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/users\/me\/onboarding$/);
    expect(init.method).toBeUndefined();
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok_123");
  });
});

describe("setOnboardingDismissed", () => {
  it("patches the dismissed flag as JSON", async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...onboardingBody, dismissedAt: "2026-09-28T05:00:00.000Z" }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const status = await setOnboardingDismissed("tok_123", true);

    expect(status.dismissedAt).toBe("2026-09-28T05:00:00.000Z");
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/users\/me\/onboarding$/);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ dismissed: true });
  });

  it("surfaces a 403 as an ApiError with the status", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: "Forbidden resource" }, 403)) as unknown as typeof fetch;

    await expect(setOnboardingDismissed("tok_123", false)).rejects.toMatchObject({ status: 403 });
  });
});

describe("addClassMember", () => {
  it("returns an added outcome for an existing student", async () => {
    const body = {
      outcome: "added",
      member: {
        id: "m1",
        joinedAt: "2026-09-28T00:00:00.000Z",
        removedAt: null,
        student: { id: "s1", displayName: "Ada", email: "ada@example.com" },
      },
    };
    const spy = vi.fn().mockResolvedValue(jsonResponse(body, 201));
    globalThis.fetch = spy as unknown as typeof fetch;

    const result = await addClassMember("tok_123", "class-1", "ada@example.com");

    expect(result.outcome).toBe("added");
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/classes\/class-1\/members$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ email: "ada@example.com" });
  });

  it("returns an invited outcome for an email with no account", async () => {
    const body = {
      outcome: "invited",
      invitation: { id: "inv1", email: "new@example.com", createdAt: "2026-09-28T00:00:00.000Z" },
    };
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(body, 201)) as unknown as typeof fetch;

    const result = await addClassMember("tok_123", "class-1", "new@example.com");

    expect(result).toEqual(body);
  });
});

describe("cancelClassInvitation", () => {
  it("deletes the pending invitation of the class", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ message: "Invitation cancelled", invitationId: "inv1" }));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(cancelClassInvitation("tok_123", "class-1", "inv1")).resolves.toEqual({
      message: "Invitation cancelled",
      invitationId: "inv1",
    });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/classes\/class-1\/invitations\/inv1$/);
    expect(init.method).toBe("DELETE");
  });
});

describe("listSubmissionsPage", () => {
  it("sends page, limit, status, class and search as query params", async () => {
    const spy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    await listSubmissionsPage("tok_123", { page: 2, limit: 12, status: "scored", classId: "none", q: "Lan" });

    const url = new URL(String(spy.mock.calls[0]![0]), "http://x");
    expect(url.pathname).toMatch(/\/submissions$/);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "2",
      limit: "12",
      status: "scored",
      classId: "none",
      q: "Lan",
    });
  });
});

describe("feedback survey client", () => {
  it("reads the caller's survey state", async () => {
    const state = { role: "teacher", instrumentVersion: 1, gradedCount: 12, prompt: true, response: null };
    const spy = vi.fn().mockResolvedValue(jsonResponse(state));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(getFeedback("tok")).resolves.toEqual(state);
    expect(String(spy.mock.calls[0]![0])).toMatch(/\/feedback\/me$/);
  });

  it("PUTs the answers and returns the saved response", async () => {
    const view = { instrumentVersion: 1, answers: { ux1: 4 }, editCount: 0, createdAt: "a", updatedAt: "b" };
    const spy = vi.fn().mockResolvedValue(jsonResponse(view));
    globalThis.fetch = spy as unknown as typeof fetch;

    await expect(saveFeedback("tok", 1, { ux1: 4 })).resolves.toEqual({ ok: true, response: view });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/feedback\/me$/);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ instrumentVersion: 1, answers: { ux1: 4 } });
  });

  it("returns the failing items on invalid_answers", async () => {
    const items = [{ code: "ux1", reason: "required" }];
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "invalid_answers", items }, 400)) as unknown as typeof fetch;

    await expect(saveFeedback("tok", 1, {})).resolves.toEqual({ ok: false, error: "invalid_answers", items });
  });

  it("reports a stale questionnaire", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "instrument_version_mismatch" }, 400)) as unknown as typeof fetch;

    await expect(saveFeedback("tok", 1, {})).resolves.toEqual({
      ok: false,
      error: "instrument_version_mismatch",
    });
  });

  it("throws ApiError with the server message on any other failure", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ message: ["answers must be an object"] }, 400)) as unknown as typeof fetch;
    await expect(saveFeedback("tok", 1, {})).rejects.toMatchObject({
      status: 400,
      message: "answers must be an object",
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("offline")) as unknown as typeof fetch;
    await expect(saveFeedback("tok", 1, {})).rejects.toMatchObject({ status: 0 });
  });

  it("POSTs the pop-up dismissal", async () => {
    const spy = vi.fn().mockResolvedValue(jsonResponse({ prompt: false }));
    globalThis.fetch = spy as unknown as typeof fetch;

    await dismissFeedbackPrompt("tok");
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/feedback\/me\/prompt-dismissal$/);
    expect(init.method).toBe("POST");
  });

  it("downloads the export as a blob", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("resp_id\n", { status: 200 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    const blob = await downloadFeedbackExport("tok", "sps");
    await expect(blob.text()).resolves.toBe("resp_id\n");
    expect(String(spy.mock.calls[0]![0])).toMatch(/\/feedback\/export\?format=sps$/);
  });
});
