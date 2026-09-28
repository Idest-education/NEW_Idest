/** Lifetime of a class email invite; mirrors the server's Clerk `expiresInDays`. */
export const INVITE_TTL_DAYS = 30;

/** A pending invite older than the Clerk invite lifetime can no longer be accepted. */
export function isInviteExpired(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/** Vietnamese copy for the add-by-email failures the teacher can act on; null = use the server's. */
export function inviteErrorMessage(status: number): string | null {
  if (status === 503) return "Không gửi được email mời. Thử lại sau.";
  if (status === 409) {
    return "Email này đã có tài khoản nhưng chưa từng mở Idest. Nhờ học viên đăng nhập một lần rồi thêm lại.";
  }
  return null;
}
