"use client";

import { use, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  ASSIGNMENT_STATUS_LABEL,
  TASK_TYPE_LABEL,
  type Assignment,
  type SubmissionRow,
  type UntaggedRevision,
  getAssignment,
  listSubmissions,
  listUntaggedRevisions,
  updateAssignment,
  updateAssignmentStatus,
} from "../../../../lib/idest";
import { day, stamp } from "../../../../lib/format";
import { useAction, useResource } from "../../../../lib/use-api";
import { ActionMenu, Blank, Notice, Shell, Strip, WaitingRack, board as s } from "../../../../components/board";
import { ReasonBatchModal, UntaggedBadge } from "../../../../components/reason-batch-modal";

export default function AssignmentDesk({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, state, error, reload } = useResource<{ assignment: Assignment; rows: SubmissionRow[] }>(
    async (token) => ({
      assignment: await getAssignment(id, token),
      rows: await listSubmissions(id, token),
    }),
    [id],
  );
  const { busy, error: actionError, run } = useAction();

  const { data: untagged, reload: reloadUntagged } = useResource<UntaggedRevision[]>(
    (token) => listUntaggedRevisions(id, token),
    [id],
  );
  const untaggedRows = untagged ?? [];
  const [reasonOpen, setReasonOpen] = useState(false);

  const openReasons = useCallback(() => setReasonOpen(true), []);
  const closeReasons = useCallback(() => setReasonOpen(false), []);

  const rows = useMemo(
    () => (data?.rows ?? []).slice().sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt)),
    [data],
  );

  const toggleHighlight = async () => {
    if (!data) return;
    const done = await run((token) =>
      updateAssignment(token, data.assignment.id, { highlighted: !data.assignment.highlighted }),
    );
    if (done) await reload();
  };

  const setStatus = async (status: "active" | "closed") => {
    if (!data) return;
    const done = await run((token) => updateAssignmentStatus(token, data.assignment.id, status));
    if (done) await reload();
  };

  return (
    <Shell role="teacher" wide>
      {state === "loading" ? <WaitingRack /> : null}
      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}

      {state === "ready" && data ? (
        <>
          <div className={s.slugLine}>
            <span className={s.slugRef}>{TASK_TYPE_LABEL[data.assignment.taskType]}</span>
            <h1 className={s.title} style={{ marginRight: "auto" }}>
              {data.assignment.title}
              {data.assignment.highlighted ? " ★" : ""}
            </h1>
            <UntaggedBadge count={untaggedRows.length} onOpen={openReasons} />
            <ActionMenu label="Tùy chọn bài tập">
              <button type="button" className={s.actionMenuItem} disabled={busy} onClick={toggleHighlight}>
                {data.assignment.highlighted ? "Bỏ ghim nổi bật" : "Ghim nổi bật"}
              </button>
              {data.assignment.status !== "active" ? (
                <button type="button" className={s.actionMenuItem} disabled={busy} onClick={() => setStatus("active")}>
                  Mở bài tập
                </button>
              ) : (
                <button type="button" className={s.actionMenuItem} disabled={busy} onClick={() => setStatus("closed")}>
                  Đóng bài tập
                </button>
              )}
              <Link href="/teacher/assignments" className={s.actionMenuItem}>
                Sửa chi tiết / xóa
              </Link>
            </ActionMenu>
          </div>

          <div className={s.slugMeta} style={{ marginTop: "0.6rem" }}>
            <span
              className={
                data.assignment.status === "active" ? s.paperStamp : `${s.paperStamp} ${s.paperStampQuiet}`
              }
            >
              {ASSIGNMENT_STATUS_LABEL[data.assignment.status]}
            </span>
            <span>hạn {day(data.assignment.dueAt)}</span>
            <span>
              <span className={s.figure}>{rows.length}</span> bài nộp
            </span>
            {data.assignment.class ? (
              <span>
                <span className={s.figure}>{data.assignment.class.memberCount ?? "—"}</span> học viên nhận bài (
                {data.assignment.class.name})
              </span>
            ) : (
              <span>Gửi cho tất cả học viên</span>
            )}
          </div>

          <div className={s.promptPop}>
            <span className={s.promptPopMark} aria-hidden="true">
              “
            </span>
            <p className={s.promptPopText}>{data.assignment.taskPrompt}</p>
          </div>
          {data.assignment.taskImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.assignment.taskImageUrl} alt="Biểu đồ/sơ đồ của đề bài" className={s.promptImage} />
          ) : null}

          {actionError ? <Notice tone="alert">{actionError}</Notice> : null}

          <div className={s.sectionHead} style={{ marginTop: "1.5rem" }}>
            <h2 className={s.sectionTitle}>Bài nộp của bài tập này</h2>
            <Link href="/teacher" className={s.pressQuiet}>
              ← Tổng quan
            </Link>
          </div>

          {rows.length === 0 ? (
            <Blank art="speaking" title="Chưa có bài nộp nào cho bài tập này">
              Mở bài tập và gửi lời mời cho học viên; bài nộp sẽ tự động xuất hiện ở đây.
            </Blank>
          ) : (
            <div className={s.rack}>
              {rows.map((row) => (
                <Strip
                  key={row.id}
                  href={`/teacher/submissions/${row.id}`}
                  submissionId={row.id}
                  attempt={row.attemptNumber}
                  title={row.student?.displayName ?? "Học viên"}
                  meta={[`${row.wordCount} từ`, `nộp ${stamp(row.submittedAt)}`]}
                  status={row.status}
                  scores={row.publishedResults?.[0]?.finalScores}
                  machinePrinted={false}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
      <ReasonBatchModal
        open={reasonOpen}
        onClose={closeReasons}
        revisions={untaggedRows}
        onTagged={reloadUntagged}
      />
    </Shell>
  );
}
