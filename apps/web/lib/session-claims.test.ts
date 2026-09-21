import { describe, expect, it, vi } from "vitest";
import { roleFromSessionToken, waitForRoleClaim } from "./session-claims";

function jwt(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `header.${body}.signature`;
}

describe("roleFromSessionToken", () => {
  it("reads the role out of the metadata claim", () => {
    expect(roleFromSessionToken(jwt({ metadata: { role: "teacher" } }))).toBe("teacher");
    expect(roleFromSessionToken(jwt({ metadata: { role: "student" } }))).toBe("student");
  });

  it("decodes a payload carrying non-ASCII characters", () => {
    expect(
      roleFromSessionToken(jwt({ name: "Huỳnh Chí Hên", metadata: { role: "teacher" } })),
    ).toBe("teacher");
  });

  it("returns undefined when the claim is absent, unknown or malformed", () => {
    expect(roleFromSessionToken(jwt({ metadata: {} }))).toBeUndefined();
    expect(roleFromSessionToken(jwt({}))).toBeUndefined();
    expect(roleFromSessionToken(jwt({ metadata: { role: "superuser" } }))).toBeUndefined();
    expect(roleFromSessionToken("not-a-jwt")).toBeUndefined();
    expect(roleFromSessionToken(null)).toBeUndefined();
  });
});

describe("waitForRoleClaim", () => {
  const sleep = () => Promise.resolve();

  it("returns the role from the first uncached token when it already carries one", async () => {
    const getToken = vi.fn().mockResolvedValue(jwt({ metadata: { role: "teacher" } }));
    await expect(waitForRoleClaim(getToken, { sleep })).resolves.toBe("teacher");
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(getToken).toHaveBeenCalledWith({ skipCache: true });
  });

  it("retries until a freshly minted token carries the role", async () => {
    const getToken = vi
      .fn()
      .mockResolvedValueOnce(jwt({ metadata: {} }))
      .mockResolvedValueOnce(jwt({ metadata: {} }))
      .mockResolvedValue(jwt({ metadata: { role: "student" } }));
    await expect(waitForRoleClaim(getToken, { sleep })).resolves.toBe("student");
    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempt budget instead of hanging", async () => {
    const getToken = vi.fn().mockResolvedValue(jwt({ metadata: {} }));
    await expect(waitForRoleClaim(getToken, { attempts: 4, sleep })).resolves.toBeUndefined();
    expect(getToken).toHaveBeenCalledTimes(4);
  });

  it("keeps retrying when a token fetch throws", async () => {
    const getToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(jwt({ metadata: { role: "teacher" } }));
    await expect(waitForRoleClaim(getToken, { sleep })).resolves.toBe("teacher");
    expect(getToken).toHaveBeenCalledTimes(2);
  });
});
