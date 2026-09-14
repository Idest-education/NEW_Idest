"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  type SubmissionListRow,
  type SubmissionStatus,
  listAllSubmissions,
} from "../../lib/idest";
import { stamp } from "../../lib/format";
import { useResource } from "../../lib/use-api";
import { Blank, Notice, Shell, Strip, WaitingRack, board as s } from "../../components/board";

const WAITING_STATUSES: SubmissionStatus[] = ["submitted", "queued", "scoring", "scored", "under_review", "failed"];

export default function TeacherDashboard() {
  const { data, state, error } = useResource<SubmissionListRow[]>((token) => listAllSubmissions(token));

  const stats = useMemo(() => {
    const rows = data ?? [];
    const count = (statuses: SubmissionStatus[]) => rows.filter((r) => statuses.includes(r.status)).length;
    return {
      total: rows.length,
      waitingAi: count(["submitted", "queued", "scoring"]),
      waitingTeacher: count(["scored"]),
      inReview: count(["under_review"]),
      signed: count(["published"]),
      failed: count(["failed"]),
      openRedo: rows.filter((r) => r.openRedoRequest).length,
    };
  }, [data]);

  const waiting = useMemo(
    () =>
      (data ?? [])
        .filter((row) => WAITING_STATUSES.includes(row.status))
        .sort((a, b) => +new Date(a.submittedAt) - +new Date(b.submittedAt))
        .slice(0, 6),
    [data],
  );

  return (
    <Shell role="teacher" wide>
      <h1 className={s.title}>Tổng quan</h1>
      <p className={s.subtitle}>
        AI chấm sơ bộ mỗi bài nộp; không bài nào đến tay học viên khi bạn chưa duyệt.
      </p>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" ? <WaitingRack /> : null}

      {state === "ready" ? (
        <>
          <div className={s.statGrid}>
            <div className={s.statTile}>
              <span className={s.label}>Chờ AI chấm</span>
              <span className={s.statFigure}>{stats.waitingAi}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.label}>Chờ giáo viên</span>
              <span className={s.statFigure}>{stats.waitingTeacher}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.label}>Đang sửa</span>
              <span className={s.statFigure}>{stats.inReview}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.label}>Đã duyệt</span>
              <span className={s.statFigure}>{stats.signed}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.label}>AI Chấm lỗi</span>
              <span className={s.statFigure}>{stats.failed}</span>
            </div>
            <div className={s.statTile}>
              <span className={s.label}>Yêu cầu làm lại</span>
              <span className={s.statFigure}>{stats.openRedo}</span>
            </div>
          </div>

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Truy cập nhanh</h2>
          </div>
          <div className={s.quickGrid}>
            <Link href="/teacher/assignments" className={s.quickLink}>
              <span className={s.quickLinkHead}>
                <span className={s.quickLinkTitle}>Bài tập</span>
                <span className={s.quickLinkArrow} aria-hidden="true">→</span>
              </span>
              <p className={s.quickLinkHint}>
                Xem, tạo, sửa, xóa, ghim nổi bật và đặt hạn nộp cho từng bài tập.
              </p>
            </Link>
            <Link href="/teacher/classes" className={s.quickLink}>
              <span className={s.quickLinkHead}>
                <span className={s.quickLinkTitle}>Lớp học</span>
                <span className={s.quickLinkArrow} aria-hidden="true">→</span>
              </span>
              <p className={s.quickLinkHint}>
                Xem, tạo, sửa lớp; thêm/xóa học viên; tạo liên kết mời vào lớp.
              </p>
            </Link>
            <Link href="/teacher/submissions" className={s.quickLink}>
              <span className={s.quickLinkHead}>
                <span className={s.quickLinkTitle}>Bài nộp</span>
                <span className={s.quickLinkArrow} aria-hidden="true">→</span>
              </span>
              <p className={s.quickLinkHint}>
                Xem toàn bộ bài nộp, chấm điểm, và yêu cầu học viên làm lại.
              </p>
            </Link>
            <Link href="/profile" className={s.quickLink}>
              <span className={s.quickLinkHead}>
                <span className={s.quickLinkTitle}>Cài đặt</span>
                <span className={s.quickLinkArrow} aria-hidden="true">→</span>
              </span>
              <p className={s.quickLinkHint}>
                Hồ sơ cá nhân, mời học viên qua email, tạo liên kết mời vào lớp.
              </p>
            </Link>
          </div>

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Bài cần chú ý</h2>
            <Link href="/teacher/submissions" className={s.navLink}>
              Xem tất cả →
            </Link>
          </div>

          {waiting.length === 0 ? (
            <Blank art="writing" title="Không có bài nào đang chờ">
              Khi học viên nộp bài, bài nộp sẽ nằm ở đây cho đến khi bạn duyệt điểm.
            </Blank>
          ) : (
            <div className={s.rack}>
              {waiting.map((row) => (
                <Strip
                  key={row.id}
                  href={`/teacher/submissions/${row.id}`}
                  submissionId={row.id}
                  attempt={row.attemptNumber}
                  title={row.student.displayName}
                  meta={[
                    row.assignment.title,
                    `${row.wordCount} từ`,
                    `nộp ${stamp(row.submittedAt)}`,
                    row.openRedoRequest ? "đã yêu cầu làm lại" : "",
                  ].filter(Boolean)}
                  status={row.status}
                  scores={row.aiScores ?? undefined}
                  showCriteria={Boolean(row.aiScores)}
                />
              ))}
            </div>
          )}
        </>
      ) : null}
    </Shell>
  );
}
