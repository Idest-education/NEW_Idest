"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  STUDENT_STATE_LABEL,
  TASK_TYPE_LABEL,
  type Assignment,
  type StudentSubmissionListRow,
  listAllSubmissions,
  listAssignments,
} from "../../lib/idest";
import { band, day, stamp } from "../../lib/format";
import { useResource } from "../../lib/use-api";
import { Blank, Notice, Shell, Strip, WaitingRack, board as s } from "../../components/board";
import { FeedbackBanner } from "../../components/feedback-banner";

type Loaded = { assignments: Assignment[]; mine: StudentSubmissionListRow[] };

export default function StudentBoard() {
  const { data, state, error } = useResource<Loaded>(async (token) => ({
    assignments: await listAssignments(token),
    mine: await listAllSubmissions<StudentSubmissionListRow[]>(token),
  }));

  const submittedFor = useMemo(
    () => new Set((data?.mine ?? []).map((row) => row.assignmentId)),
    [data],
  );

  // Open assignments the student has not yet attempted, soonest deadline first.
  const open = useMemo(
    () =>
      (data?.assignments ?? [])
        .filter((a) => !submittedFor.has(a.id))
        .sort((a, b) => {
          if (!a.dueAt) return 1;
          if (!b.dueAt) return -1;
          return +new Date(a.dueAt) - +new Date(b.dueAt);
        }),
    [data, submittedFor],
  );

  // The one assignment the page leads with: the teacher's highlighted pick,
  // or — when none is pinned — whichever open assignment is due soonest.
  const featured = useMemo(() => {
    const highlighted = open.find((a) => a.highlighted);
    return highlighted ?? open[0] ?? null;
  }, [open]);

  const rest = open.filter((a) => a.id !== featured?.id);

  const mine = useMemo(
    () => (data?.mine ?? []).slice().sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt)),
    [data],
  );

  return (
    <Shell role="student">
      <FeedbackBanner />
      <h1 className={s.title}>Bài viết của bạn</h1>
      <p className={s.subtitle}>Chọn bài tập, viết bài, nộp. Giáo viên đọc, sửa và duyệt trước khi bạn thấy điểm.</p>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" ? <WaitingRack /> : null}

      {state === "ready" && data ? (
        <>
          <div className={s.actionRow}>
            <Link href="/student/classes" className={s.navLink}>
              Lớp của tôi →
            </Link>
          </div>

          {featured ? (
            <Link href={`/student/assignments/${featured.id}`} className={s.hero}>
              <span className={s.heroKicker}>
                {featured.highlighted ? "Giáo viên chọn — làm bài này trước" : "Gần hạn nhất"}
              </span>
              <h2 className={s.heroTitle}>{featured.title}</h2>
              <span className={s.heroMeta}>
                <span>{TASK_TYPE_LABEL[featured.taskType]}</span>
                <span>hạn {day(featured.dueAt)}</span>
                {featured.class ? <span>{featured.class.name}</span> : null}
              </span>
              <p className={s.heroPrompt}>{featured.taskPrompt}</p>
              <div className={s.actionRow}>
                <span className={s.press}>Viết bài</span>
              </div>
            </Link>
          ) : (
            <Blank art="reading" title="Không có bài tập nào đang mở">
              Khi giáo viên giao bài tập mới, bài đó sẽ hiện ở đây để bạn viết bài.
            </Blank>
          )}

          {rest.length > 0 ? (
            <>
              <div className={s.sectionHead}>
                <h2 className={s.sectionTitle}>Bài tập khác đang mở</h2>
                <span className={s.label}>{rest.length} bài tập</span>
              </div>
              <div className={s.rack}>
                {rest.map((assignment) => (
                  <Link
                    key={assignment.id}
                    href={`/student/assignments/${assignment.id}`}
                    className={`${s.strip} ${s.stripScored}`}
                  >
                    <span className={s.stripRef}>{TASK_TYPE_LABEL[assignment.taskType]}</span>
                    <span className={s.stripBody}>
                      <span className={s.stripName}>{assignment.title}</span>
                      <span className={s.stripMeta}>
                        <span>hạn {day(assignment.dueAt)}</span>
                        {assignment.class ? <span>{assignment.class.name}</span> : null}
                      </span>
                    </span>
                    <span className={s.stripEnd}>
                      <span className={s.stripState}>Viết bài</span>
                    </span>
                  </Link>
                ))}
              </div>
            </>
          ) : null}

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Bài đã nộp</h2>
            <span className={s.label}>{mine.length} bài</span>
          </div>

          {mine.length === 0 ? (
            <Blank art="writing" title="Bạn chưa nộp bài nào">
              Chọn một bài tập ở trên, viết thẳng trên trang rồi nộp.
            </Blank>
          ) : (
            <div className={s.rack}>
              {mine.map((row) => (
                <Strip
                  key={row.id}
                  href={`/student/submissions/${row.id}`}
                  submissionId={row.id}
                  attempt={row.attemptNumber}
                  title={row.assignment.title}
                  meta={[
                    `lần ${row.attemptNumber}`,
                    `${row.wordCount} từ`,
                    `nộp ${stamp(row.submittedAt)}`,
                    row.publishedResult ? `duyệt ${stamp(row.publishedResult.publishedAt)}` : "",
                  ].filter(Boolean)}
                  status={row.status}
                  treatment={row.openRedoRequest ? "failed" : row.status === "failed" ? "queued" : row.status}
                  statusLabel={row.openRedoRequest ? "Cần làm lại" : STUDENT_STATE_LABEL[row.status]}
                  scores={row.publishedResult?.finalScores}
                  machinePrinted={false}
                  showCriteria={Boolean(row.publishedResult)}
                />
              ))}
            </div>
          )}

          {mine.some((row) => row.publishedResult) ? (
            <p className={s.fieldHint} style={{ marginTop: "1rem" }}>
              Điểm cao nhất đã duyệt:{" "}
              {band(
                Math.max(
                  ...mine
                    .flatMap((row) => (row.publishedResult ? [row.publishedResult] : []))
                    .map((p) => p.finalScores.overall ?? 0),
                ),
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}
