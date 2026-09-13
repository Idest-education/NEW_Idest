"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BAY_LABEL,
  type SubmissionListRow,
  type SubmissionStatus,
  listAllSubmissions,
} from "../../../lib/idest";
import { stamp } from "../../../lib/format";
import { useResource } from "../../../lib/use-api";
import { Blank, Notice, Shell, Strip, WaitingRack, board as s } from "../../../components/board";

const FILTERS: Array<{ id: string; label: string; statuses: SubmissionStatus[] | null }> = [
  { id: "all", label: "Tất cả", statuses: null },
  { id: "waiting", label: "Chờ giáo viên", statuses: ["scored"] },
  { id: "review", label: "Đang sửa", statuses: ["under_review"] },
  { id: "signed", label: "Đã duyệt", statuses: ["published"] },
  { id: "failed", label: "Chấm lỗi", statuses: ["failed"] },
];

export default function AllSubmissionsPage() {
  const { data, state, error } = useResource<SubmissionListRow[]>((token) => listAllSubmissions(token));
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;

  const rows = useMemo(() => {
    let list = data ?? [];
    if (active.statuses) list = list.filter((r) => active.statuses!.includes(r.status));
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.student.displayName.toLowerCase().includes(q) ||
          r.student.email.toLowerCase().includes(q) ||
          r.assignment.title.toLowerCase().includes(q),
      );
    }
    return list.slice().sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt));
  }, [data, active, query]);

  return (
    <Shell role="teacher" wide>
      <div className={s.slugLine}>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          Bài nộp
        </h1>
        <Link href="/teacher" className={s.navLink}>
          ← Tổng quan
        </Link>
      </div>
      <p className={s.subtitle}>Toàn bộ bài nộp của mọi bài tập, một chỗ để lọc, tìm và mở từng bài.</p>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" ? <WaitingRack /> : null}

      {state === "ready" ? (
        <>
          <div className={s.actionRow}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={f.id === filter ? s.press : s.pressQuiet}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
            <input
              className={s.field}
              style={{ maxWidth: "16rem" }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tên học viên hoặc bài tập"
            />
          </div>

          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>{rows.length} bài nộp</h2>
          </div>

          {rows.length === 0 ? (
            <Blank art="writing" title="Không có bài nộp nào khớp">
              Đổi bộ lọc hoặc xóa từ khóa tìm kiếm.
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
        </>
      ) : null}
    </Shell>
  );
}
