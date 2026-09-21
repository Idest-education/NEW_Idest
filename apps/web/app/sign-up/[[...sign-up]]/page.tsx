import { SignUp, SignOutButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Role } from "@repo/auth-contract";
import styles from "../../auth.module.css";
import { Notice, board as s } from "../../../components/board";

const ROLE_LABEL: Record<string, string> = {
  teacher: "giáo viên",
  student: "học viên",
  admin: "quản trị viên",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const ticket = params.__clerk_ticket;

  // A Clerk invitation ticket (created by InvitationController, always for a
  // student account) redirects here. If the visitor is already signed in,
  // they're not the intended recipient — accepting would either overwrite an
  // existing account's role or create a duplicate student account. Block and
  // explain instead of letting <SignUp> silently no-op or misbehave.
  if (typeof ticket === "string") {
    const { userId, sessionClaims } = await auth();
    if (userId) {
      const role = (sessionClaims?.metadata as { role?: Role } | undefined)?.role;
      const message =
        role === "student"
          ? "Bạn đã có tài khoản học viên. Mỗi lời mời chỉ dùng để tạo một tài khoản học viên mới — đừng mở lời mời học viên khác."
          : `Đây là lời mời dành cho học viên, nhưng bạn đang đăng nhập bằng tài khoản ${
              ROLE_LABEL[role ?? ""] ?? "khác"
            }.`;
      const retryUrl = `/sign-up?__clerk_ticket=${encodeURIComponent(ticket)}`;

      return (
        <div className={styles.wrap}>
          <div className={s.railBlock}>
            <Notice tone="alert">{message}</Notice>
            <div className={s.actionRow} style={{ marginTop: "0.75rem" }}>
              <SignOutButton redirectUrl={retryUrl}>
                <button type="button" className={s.pressQuiet}>
                  Đăng xuất, dùng tài khoản khác
                </button>
              </SignOutButton>
            </div>
          </div>
        </div>
      );
    }
  }

  // Force the post-signup destination to /welcome rather than honouring any
  // redirect_url query param: that param can point at a role-gated route
  // (e.g. /student) which the proxy middleware bounces before the role claim
  // is visible. /welcome is never role-gated, so it's always safe to land on
  // straight away, and it's where a brand-new account picks a display name
  // before being sent on to its dashboard.
  return (
    <div className={styles.wrap}>
      <SignUp signInUrl="/sign-in" forceRedirectUrl="/welcome" />
    </div>
  );
}
