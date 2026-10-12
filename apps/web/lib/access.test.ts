import { describe, expect, it } from "vitest";
import { accessFor, decide, roleAllows } from "./access";

describe("accessFor", () => {
  it.each([
    ["/", "public"],
    ["/r/123", "public"],
    ["/sign-in/factor-one", "public"],
    ["/history", "teacher"],
    ["/batches", "teacher"],
    ["/batches/new", "teacher"],
    ["/review/abc", "teacher"],
    ["/account", "signed-in"],
    ["/help", "signed-in"],
    ["/admin", "admin"],
    ["/batchesx", "public"],
    ["/teacher/classes", "public"],
  ])("%s is %s", (path, access) => {
    expect(accessFor(path)).toBe(access);
  });
});

describe("decide", () => {
  it("lets anyone through public pages", () => {
    expect(decide("/", false, undefined)).toBe("allow");
    expect(decide("/r/1", false, undefined)).toBe("allow");
  });

  it("sends signed-out visitors to sign in", () => {
    expect(decide("/batches", false, undefined)).toBe("sign-in");
    expect(decide("/account", false, undefined)).toBe("sign-in");
  });

  it("does not bounce a new account whose token has no role yet", () => {
    expect(decide("/batches", true, undefined)).toBe("check-role");
    expect(decide("/admin", true, undefined)).toBe("check-role");
    expect(decide("/account", true, undefined)).toBe("allow");
  });

  it("routes by role", () => {
    expect(decide("/batches/1", true, "teacher")).toBe("allow");
    expect(decide("/batches/1", true, "admin")).toBe("allow");
    expect(decide("/batches/1", true, "student")).toBe("home");
    expect(decide("/admin", true, "teacher")).toBe("home");
    expect(decide("/admin", true, "admin")).toBe("allow");
  });
});

describe("roleAllows", () => {
  it("lets admins into teacher pages but not the reverse", () => {
    expect(roleAllows("teacher", "admin")).toBe(true);
    expect(roleAllows("admin", "teacher")).toBe(false);
    expect(roleAllows("signed-in", "student")).toBe(true);
  });
});
