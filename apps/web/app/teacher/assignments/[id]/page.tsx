"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import {
  ASSIGNMENT_STATUS_LABEL,
  TASK_TYPE_LABEL,
  type Assignment,
  type SubmissionRow,
  getAssignment,
  listSubmissions,
  updateAssignment,
  updateAssignmentStatus,
} from "../../../../lib/idest";
import { day, stamp } from "../../../../lib/format";
import { useAction, useResource } from "../../../../lib/use-api";
import { Blank, Notice, Shell, Strip, WaitingRack, board as s } from "../../../../components/board";

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

  const rows = useMemo(
    () => (data?.rows ?? []).slice().sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt)),
    [data],
  );

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
            <span className={s.slugMeta}>
              <span>{ASSIGNMENT_STATUS_LABEL[data.assignment.status]}</span>
              <span>hạn {day(data.assignment.dueAt)}</span>
              <span>{rows.length} bài nộp</span>
            </span>
          </div>

          <p className={s.prompt}>{data.assignment.taskPrompt}</p>

          {actionError ? <Notice tone="alert">{actionError}</Notice> : null}
          <div className={s.actionRow}>
            <button
              type="button"
              className={s.pressQuiet}
              disabled={busy}
              onClick={async () => {
                const done = await run((token) =>
                  updateAssignment(token, data.assignment.id, { highlighted: !data.assignment.highlighted }),
                );
                if (done) await reload();
              }}
            >
              {data.assignment.highlighted ? "Bỏ ghim nổi bật" : "Ghim nổi bật"}
            </button>
            {data.assignment.status !== "active" ? (
              <button
                type="button"
                className={s.pressQuiet}
                disabled={busy}
                onClick={async () => {
                  const done = await run((token) => updateAssignmentStatus(token, data.assignment.id, "active"));
                  if (done) await reload();
                }}
              >
                Mở bài tập
              </button>
            ) : (
              <button
                type="button"
                className={s.pressQuiet}
                disabled={busy}
                onClick={async () => {
                  const done = await run((token) => updateAssignmentStatus(token, data.assignment.id, "closed"));
                  if (done) await reload();
                }}
              >
                Đóng bài tập
              </button>
            )}
            <Link href="/teacher/assignments" className={s.navLink}>
              Sửa chi tiết / xóa →
            </Link>
          </div>

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Bài nộp của bài tập này</h2>
            <Link href="/teacher" className={s.navLink}>
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
    </Shell>
  );
}
