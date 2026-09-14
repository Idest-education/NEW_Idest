"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth, SignOutButton } from "@clerk/nextjs";
import { type InvitePreview, type Profile, acceptInviteLink, getProfile, previewInviteLink } from "../../../lib/idest";
import { useAction, useResource } from "../../../lib/use-api";
import { Blank, Notice, Shell, WaitingRack, board as s } from "../../../components/board";

const PROBLEM_LABEL: Record<string, string> = {
  link_revoked: "Liên kết này đã bị thu hồi.",
  class_deleted: "Lớp này không còn tồn tại.",
  class_archived: "Lớp này đã được lưu trữ, không nhận thêm học viên.",
  link_expired: "Liên kết này đã hết hạn.",
  link_exhausted: "Liên kết này đã hết lượt sử dụng.",
};

const ROLE_LABEL: Record<string, string> = {
  teacher: "giáo viên",
  student: "học viên",
  admin: "quản trị viên",
};

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { data, state, error } = useResource<InvitePreview>(
    (t) => previewInviteLink(t, token),
    [token],
  );

  return (
    <Shell>
      <h1 className={s.title}>Tham gia lớp học</h1>

      {state === "loading" ? <WaitingRack rows={1} /> : null}
      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}

      {state === "ready" && data ? (
        !data.valid ? (
          <Blank art="404" title="Liên kết không dùng được">
            {data.problem ? PROBLEM_LABEL[data.problem] ?? "Liên kết này không còn hợp lệ." : "Liên kết này không còn hợp lệ."}
          </Blank>
        ) : (
          <div className={s.railBlock} style={{ marginTop: "1.25rem" }}>
            <p>
              Giáo viên <strong>{data.teacherName}</strong> mời bạn vào lớp{" "}
              <strong>{data.className}</strong>.
            </p>

            {!authLoaded ? (
              <WaitingRack rows={1} />
            ) : !isSignedIn ? (
              <ChooseAccountPath token={token} />
            ) : (
              <JoinAsSignedInUser token={token} />
            )}
          </div>
        )
      ) : null}
    </Shell>
  );
}

function ChooseAccountPath({ token }: { token: string }) {
  return (
    <div className={s.actionRow} style={{ marginTop: "1rem" }}>
      <Link href={`/join/${token}/sign-in`} className={s.press}>
        Tôi đã có tài khoản — Đăng nhập
      </Link>
      <Link href={`/join/${token}/sign-up`} className={s.pressQuiet}>
        Tôi chưa có tài khoản — Đăng ký
      </Link>
    </div>
  );
}

function JoinAsSignedInUser({ token }: { token: string }) {
  const { data: profile, state: profileState } = useResource<Profile>((t) => getProfile(t));
  const { busy, error: joinError, run } = useAction();
  const router = useRouter();

  if (profileState === "loading") return <WaitingRack rows={1} />;

  if (profileState === "ready" && profile && profile.role !== "student") {
    return (
      <>
        <Notice tone="alert">
          Tài khoản này là {ROLE_LABEL[profile.role] ?? profile.role} — cần một tài khoản học viên
          để tham gia lớp.
        </Notice>
        <div className={s.actionRow} style={{ marginTop: "0.75rem" }}>
          <SignOutButton redirectUrl={`/join/${token}`}>
            <button type="button" className={s.pressQuiet}>
              Đăng xuất, dùng tài khoản khác
            </button>
          </SignOutButton>
        </div>
      </>
    );
  }

  return (
    <>
      {joinError ? <Notice tone="alert">{joinError}</Notice> : null}
      <div className={s.actionRow} style={{ marginTop: "1rem" }}>
        <button
          type="button"
          className={s.press}
          disabled={busy}
          onClick={async () => {
            const done = await run((t) => acceptInviteLink(t, token));
            if (done) router.push(`/student/classes/${done.classId}`);
          }}
        >
          {busy ? "Đang tham gia…" : "Tham gia lớp"}
        </button>
      </div>
    </>
  );
}
