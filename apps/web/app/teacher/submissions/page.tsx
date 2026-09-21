"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BAY_LABEL,
  type SubmissionPage,
  type SubmissionStatus,
  listSubmissionsPage,
} from "../../../lib/idest";
import { stamp } from "../../../lib/format";
import { useResource } from "../../../lib/use-api";
import { Blank, Notice, Shell, Strip, WaitingRack, board as s } from "../../../components/board";

const PAGE_SIZE = 12;

const FILTERS: Array<{ id: string; label: string; status: SubmissionStatus | null }> = [
  { id: "all", label: "Tất cả", status: null },
  { id: "waiting", label: "Chờ giáo viên", status: "scored" },
  { id: "review", label: "Đang sửa", status: "under_review" },
  { id: "signed", label: "Đã duyệt", status: "published" },
  { id: "failed", label: "Chấm lỗi", status: "failed" },
  { id: "abuse", label: "Nghi ngờ vi phạm", status: "abuse" },
];

export default function AllSubmissionsPage() {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;

  const { data, state, error } = useResource<SubmissionPage>(
    (token) =>
      listSubmissionsPage(token, {
        page,
        limit: PAGE_SIZE,
        status: active.status ?? undefined,
        q: debouncedQuery || undefined,
      }),
    [page, active.status, debouncedQuery],
  );

  const rows = data?.data ?? [];
  const hasFilters = filter !== "all" || debouncedQuery.length > 0;

  return (
    <Shell role="teacher" wide>
      <div className={s.slugLine}>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          Bài nộp
        </h1>
        <Link href="/teacher" className={s.pressQuiet}>
          ← Tổng quan
        </Link>
      </div>
      <p className={s.subtitle}>Toàn bộ bài nộp của mọi bài tập, một chỗ để lọc, tìm và mở từng bài.</p>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" ? <WaitingRack /> : null}

      {state === "ready" && data ? (
        <>
          <div className={s.actionRow}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={f.id === filter ? s.press : s.pressQuiet}
                onClick={() => {
                  setFilter(f.id);
                  setPage(1);
                }}
              >
                {f.label}
              </button>
            ))}
            <input
              className={s.field}
              style={{ maxWidth: "16rem" }}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Tìm theo tên học viên hoặc bài tập"
            />
          </div>

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>{data.total} bài nộp</h2>
          </div>

          {rows.length === 0 ? (
            <Blank art="writing" title={hasFilters ? "Không có bài nộp nào khớp" : "Chưa có bài nộp nào"}>
              {hasFilters
                ? "Đổi bộ lọc hoặc xóa từ khóa tìm kiếm."
                : "Khi học viên nộp bài, bài nộp sẽ xuất hiện ở đây."}
            </Blank>
          ) : (
            <div className={s.rack}>
              {rows.map((row) => (
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
                  statusLabel={BAY_LABEL[row.status]}
                  scores={row.publishedResult?.finalScores ?? row.aiScores ?? undefined}
                  machinePrinted={!row.publishedResult}
                  showCriteria={Boolean(row.publishedResult ?? row.aiScores)}
                />
              ))}
            </div>
          )}

          {data.totalPages > 1 ? (
            <div className={s.pager}>
              <button
                type="button"
                className={s.pressQuiet}
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ← Trước
              </button>
              <span className={s.pagerInfo}>
                Trang {page} / {data.totalPages}
              </span>
              <button
                type="button"
                className={s.pressQuiet}
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Sau →
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </Shell>
  );
}
