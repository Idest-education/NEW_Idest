import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listUntaggedRevisions,
  recordReviewSessionQuietly,
  submitTicket,
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
  it("posts the subject and message to the tickets endpoint", async () => {
    const spy = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    globalThis.fetch = spy as unknown as typeof fetch;

    await submitTicket("tok_123", "Không nộp được bài", "Bấm Nộp bài nhưng không có phản hồi.");

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/support\/tickets$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      subject: "Không nộp được bài",
      message: "Bấm Nộp bài nhưng không có phản hồi.",
    });
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
