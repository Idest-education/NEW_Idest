import { describe, expect, it } from "vitest";
import { homeForRole, isPublicPath, roleGate } from "./route-access";

describe("isPublicPath", () => {
  it("treats the landing page and Clerk routes as public", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/sign-in")).toBe(true);
    expect(isPublicPath("/sign-in/factor-one")).toBe(true);
    expect(isPublicPath("/sign-up")).toBe(true);
    expect(isPublicPath("/sign-up/verify-email-address")).toBe(true);
  });

  it("treats an invite link and its sign-in/sign-up steps as public", () => {
    expect(isPublicPath("/join/abc123")).toBe(true);
    expect(isPublicPath("/join/abc123/sign-in")).toBe(true);
    expect(isPublicPath("/join/abc123/sign-up")).toBe(true);
  });

  it("treats everything else as protected", () => {
    expect(isPublicPath("/teacher")).toBe(false);
    expect(isPublicPath("/student/assignments")).toBe(false);
    expect(isPublicPath("/dashboard")).toBe(false);
  });
});

describe("homeForRole", () => {
  it("maps each role to its own dashboard", () => {
    expect(homeForRole("teacher")).toBe("/teacher");
    expect(homeForRole("student")).toBe("/student");
  });

  it("leaves an admin and an unknown role on the landing page", () => {
    expect(homeForRole("admin")).toBe("/");
    expect(homeForRole(undefined)).toBe("/");
  });
});

describe("roleGate", () => {
  it("allows the matching role and unscoped routes", () => {
    expect(roleGate("/teacher/queue", "teacher")).toEqual({ kind: "allow" });
    expect(roleGate("/student/results", "student")).toEqual({ kind: "allow" });
    expect(roleGate("/welcome", undefined)).toEqual({ kind: "allow" });
    expect(roleGate("/profile", "teacher")).toEqual({ kind: "allow" });
  });

  it("sends a signed-in user with the wrong role to their own home, not the landing page", () => {
    expect(roleGate("/teacher/queue", "student")).toEqual({ kind: "redirect", to: "/student" });
    expect(roleGate("/student/results", "teacher")).toEqual({ kind: "redirect", to: "/teacher" });
    expect(roleGate("/teacher/queue", "admin")).toEqual({ kind: "redirect", to: "/" });
  });

  // The regression this whole change exists for: right after sign-up the session
  // JWT has no role claim yet, and bouncing to "/" stranded the new account on
  // the marketing page until the token happened to refresh.
  it("asks for an authoritative lookup instead of redirecting when no role claim is present", () => {
    expect(roleGate("/teacher", undefined)).toEqual({ kind: "resolve" });
    expect(roleGate("/student/submissions/1", undefined)).toEqual({ kind: "resolve" });
  });
});
