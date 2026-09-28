import { describe, expect, it } from "vitest";
import { INVITE_TTL_DAYS, inviteErrorMessage, isInviteExpired } from "./invitations";

describe("isInviteExpired", () => {
  const now = new Date("2026-10-31T00:00:00.000Z").getTime();

  it("matches the server's 30-day Clerk invite lifetime", () => {
    expect(INVITE_TTL_DAYS).toBe(30);
  });

  it("is fresh up to 30 days old", () => {
    expect(isInviteExpired("2026-10-01T00:00:00.000Z", now)).toBe(false);
  });

  it("is expired past 30 days", () => {
    expect(isInviteExpired("2026-09-30T23:59:59.000Z", now)).toBe(true);
  });
});

describe("inviteErrorMessage", () => {
  it("explains a 503: the email could not be sent", () => {
    expect(inviteErrorMessage(503)).toBe("Không gửi được email mời. Thử lại sau.");
  });

  it("explains a 409: an account exists but never opened Idest", () => {
    expect(inviteErrorMessage(409)).toBe(
      "Email này đã có tài khoản nhưng chưa từng mở Idest. Nhờ học viên đăng nhập một lần rồi thêm lại.",
    );
  });

  it("leaves every other status to the server message", () => {
    expect(inviteErrorMessage(400)).toBeNull();
    expect(inviteErrorMessage(500)).toBeNull();
  });
});
