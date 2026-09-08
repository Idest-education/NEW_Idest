import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("prefixes NEXT_PUBLIC_API_URL and attaches the bearer token", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = spy as unknown as typeof fetch;

    await apiFetch("/me", "tok_123");

    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toMatch(/\/me$/);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok_123");
  });

  it("omits the Authorization header when the token is null", async () => {
    const spy = vi.fn().mockResolvedValue(new Response("ok"));
    globalThis.fetch = spy as unknown as typeof fetch;

    await apiFetch("/health", null);

    const [, init] = spy.mock.calls[0]!;
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });
});
