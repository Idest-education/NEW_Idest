import { describe, expect, it } from "vitest";
import { isPublicPath, roleRedirectTarget } from "./route-access";

describe("isPublicPath", () => {
  it("treats the landing page and Clerk routes as public", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/sign-in/factor-one")).toBe(true);
    expect(isPublicPath("/sign-up")).toBe(true);
    expect(isPublicPath("/sign-up/verify-email-address")).toBe(true);
  });

  it("treats everything else as protected", () => {
    expect(isPublicPath("/teacher")).toBe(false);
    expect(isPublicPath("/student/assignments")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
  });
});

describe("roleRedirectTarget", () => {
  it("sends a non-teacher away from /teacher routes", () => {
    expect(roleRedirectTarget("/teacher/queue", "student")).toBe("/");
    expect(roleRedirectTarget("/teacher/queue", undefined)).toBe("/");
  });

  it("sends a non-student away from /student routes", () => {
    expect(roleRedirectTarget("/student/results", "teacher")).toBe("/");
  });

  it("allows the matching role and unscoped routes", () => {
    expect(roleRedirectTarget("/teacher/queue", "teacher")).toBeNull();
    expect(roleRedirectTarget("/student/results", "student")).toBeNull();
    expect(roleRedirectTarget("/dashboard", "teacher")).toBeNull();
  });
});
