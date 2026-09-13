"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { type InvitePreview, acceptInviteLink, previewInviteLink } from "../../../lib/idest";
import { useAction, useResource } from "../../../lib/use-api";
import { Blank, Notice, Shell, WaitingRack, board as s } from "../../../components/board";

const PROBLEM_LABEL: Record<string, string> = {
  link_revoked: "Liên kết này đã bị thu hồi.",
  class_deleted: "Lớp này không còn tồn tại.",
  class_archived: "Lớp này đã được lưu trữ, không nhận thêm học viên.",
  link_expired: "Liên kết này đã hết hạn.",
  link_exhausted: "Liên kết này đã hết lượt sử dụng.",
};

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, state, error } = useResource<InvitePreview>(
    (t) => previewInviteLink(t, token),
    [token],
  );
  const { busy, error: joinError, run } = useAction();
  const router = useRouter();

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
            {joinError ? <Notice tone="alert">{joinError}</Notice> : null}
            <div className={s.actionRow}>
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
          </div>
        )
      ) : null}
    </Shell>
  );
}
