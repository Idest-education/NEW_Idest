import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi, describeError } from "./api";

function setup(response: Response | Error = new Response("{}", { status: 200 }), token: string | null = "tok") {
  const fetcher = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response.clone();
  });
  const api = createApi(async () => token, "http://api.test", fetcher as unknown as typeof fetch);
  const sent = () => {
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    return { url, init, headers: init.headers as Record<string, string> };
  };
  return { api, fetcher, sent };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error("expected the call to fail");
}

describe("request shapes", () => {
  it("POST /grade sends multipart with the idempotency key, the token, and skips missing fields", async () => {
    const { api, sent } = setup(json({ id: "s1", status: "queued" }));
    const chart = new File(["x"], "chart.png", { type: "image/png" });
    await expect(
      api.grade({ taskType: "task_1", taskPrompt: "Q", essayText: "E", idempotencyKey: "k1", taskImage: chart }),
    ).resolves.toEqual({ id: "s1", status: "queued" });

    const { url, init, headers } = sent();
    expect(url).toBe("http://api.test/grade");
    expect(init.method).toBe("POST");
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBeUndefined(); // the browser sets the multipart boundary
    const body = init.body as FormData;
    expect(body.get("taskType")).toBe("task_1");
    expect(body.get("taskPrompt")).toBe("Q");
    expect(body.get("essayText")).toBe("E");
    expect(body.get("idempotencyKey")).toBe("k1");
    expect((body.get("taskImage") as File).name).toBe("chart.png");
    expect(body.has("transcriptionId")).toBe(false);
  });

  it("omits Authorization when signed out", async () => {
    const { api, sent } = setup(json({ id: "r" }), null);
    await api.result("r");
    expect(sent().headers.Authorization).toBeUndefined();
    expect(sent().url).toBe("http://api.test/grade/r");
  });

  it("sends each photo and each batch file under the field name the server expects", async () => {
    const a = new File(["a"], "a.jpg", { type: "image/jpeg" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });
    const photos = setup(json({ id: "t", status: "pending" }));
    await photos.api.transcribe([a, b]);
    expect((photos.sent().init.body as FormData).getAll("images")).toHaveLength(2);

    const files = setup(json([]));
    await files.api.addFiles("b1", [a, b]);
    expect(files.sent().url).toBe("http://api.test/batches/b1/files");
    expect((files.sent().init.body as FormData).getAll("files")).toHaveLength(2);
  });

  it("sends JSON for revisions, publish and abuse review", async () => {
    const scores = { task_response: 6, coherence_cohesion: 6, lexical_resource: 6.5, grammatical_range_accuracy: 6, overall: 6 };
    const feedback = { summary: "s", strengths: [], improvements: [] };
    const rev = setup(json({ id: "rev" }));
    await rev.api.saveRevision("s1", { baseResultId: "ai1", finalScores: scores, finalFeedback: feedback });
    expect(rev.sent().url).toBe("http://api.test/submissions/s1/revisions");
    expect(rev.sent().headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(rev.sent().init.body as string)).toEqual({ baseResultId: "ai1", finalScores: scores, finalFeedback: feedback });

    const pub = setup(json({}));
    await pub.api.publish("s1", "rev");
    expect(JSON.parse(pub.sent().init.body as string)).toEqual({ revisionId: "rev" });

    const abuse = setup(json({}));
    await abuse.api.abuseReview("s1", "confirm");
    expect(JSON.parse(abuse.sent().init.body as string)).toEqual({ decision: "confirm" });
  });

  it("reads the export file name from Content-Disposition", async () => {
    const res = new Response("xlsx", {
      headers: { "Content-Disposition": `attachment; filename="scores.xlsx"; filename*=UTF-8''Week%203%20-%20scores.xlsx` },
    });
    const { api } = setup(res);
    const { fileName, blob } = await api.exportBatch("b1");
    expect(fileName).toBe("Week 3 - scores.xlsx");
    expect(await blob.text()).toBe("xlsx");
  });
});

describe("error mapping", () => {
  it.each([
    ["daily_limit_reached", 429, /free gradings/],
    ["unsupported_image_type", 400, /image type isn't supported/],
    ["invalid_transcription", 400, /Upload them again/],
    ["queue_unavailable", 409, /Your essay is saved/],
  ])("maps %s to friendly copy", async (code, status, copy) => {
    const err = await failure(setup(json({ error: code }, status)).api.result("x"));
    expect(err.code).toBe(code);
    expect(err.status).toBe(status);
    expect(describeError(err)).toMatch(copy);
  });

  it("answers a rejected essay with the abuse warning, whatever the reasons", async () => {
    const err = await failure(setup(json({ error: "essay_rejected", reasons: ["too_short"] }, 400)).api.result("x"));
    expect(err.message).toBe("We detected abuse. Please be a nice person: your device and IP address have been flagged.");
  });

  it("treats a throttler 429 without a code as slow down", async () => {
    const err = await failure(setup(json({ statusCode: 429, message: "ThrottlerException: Too Many Requests" }, 429)).api.result("x"));
    expect(err.code).toBeNull();
    expect(err.message).toMatch(/Wait a minute/);
  });

  it("does not mistake Nest's reason phrase for a code", async () => {
    const err = await failure(
      setup(json({ statusCode: 400, error: "Bad Request", message: ["taskPrompt should not be empty"] }, 400)).api.result("x"),
    );
    expect(err.code).toBeNull();
    expect(err.message).toBe("taskPrompt should not be empty");
  });

  it("reports a network failure as status 0", async () => {
    const err = await failure(setup(new TypeError("fetch failed")).api.result("x"));
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/can't reach AIO/);
  });
});

describe("categoryLabel", () => {
  it("names criterion keys, with Task Achievement for Task 1, and keeps older free-text categories", async () => {
    const { categoryLabel } = await import("./api");
    expect(categoryLabel("lexical_resource", "task_2")).toEqual(expect.objectContaining({ short: "LR" }));
    expect(categoryLabel("task_response", "task_1")).toEqual({ short: "TA", name: "Task Achievement" });
    expect(categoryLabel("word_choice", "task_2")).toEqual({ short: "word choice", name: "word choice" });
  });
});
