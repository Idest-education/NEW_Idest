"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BAY_LABEL,
  type ClassSummary,
  type SubmissionPage,
  type SubmissionStatus,
  listClasses,
  listSubmissionsPage,
} from "../../../lib/idest";
import { stamp } from "../../../lib/format";
import { useResource } from "../../../lib/use-api";
import { Blank, Notice, Pager, Shell, Strip, WaitingRack, board as s } from "../../../components/board";
import v from "../../../components/list-toolbar.module.css";

const PAGE_SIZE = 12;

type FilterId = "all" | "waiting" | "review" | "signed" | "failed" | "abuse";

const FILTERS: Array<{ id: FilterId; label: string; status: SubmissionStatus | null; hideWhenEmpty?: boolean }> = [
  { id: "all", label: "Tất cả", status: null },
  { id: "waiting", label: "Chờ giáo viên", status: "scored" },
  { id: "review", label: "Đang sửa", status: "under_review" },
  { id: "signed", label: "Đã duyệt", status: "published" },
  { id: "failed", label: "Chấm lỗi", status: "failed", hideWhenEmpty: true },
  { id: "abuse", label: "Nghi ngờ vi phạm", status: "abuse", hideWhenEmpty: true },
];

const NO_CLASS = "none";

/**
 * Filters live in the URL (?status=&class=&q=&page=) so a refresh, the back
 * button after opening a submission, or a shared link all land on the same
 * view. Written with history.replaceState, which Next syncs into
 * useSearchParams without a server round-trip.
 */
function useUrlState() {
  const params = useSearchParams();
  const pathname = usePathname();

  const filter = (FILTERS.some((f) => f.id === params.get("status")) ? params.get("status") : "all") as FilterId;
  const classId = params.get("class") ?? "all";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);

  const update = (next: Partial<{ status: FilterId; class: string; q: string; page: number }>) => {
    const qs = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(next)) {
      const isDefault = value === "all" || value === "" || value === 1;
      if (isDefault) qs.delete(key);
      else qs.set(key, String(value));
    }
    const search = qs.toString();
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
  };

  return { filter, classId, q, page, update };
}

export default function AllSubmissionsPage() {
  return (
    <Suspense
      fallback={
        <Shell role="teacher" wide>
          <WaitingRack />
        </Shell>
      }
    >
      <AllSubmissions />
    </Suspense>
  );
}

function AllSubmissions() {
  const { filter, classId, q, page, update } = useUrlState();
  const [query, setQuery] = useState(q);

  // Debounce typing into the URL; every other control writes straight to it.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === q) return;
    const id = setTimeout(() => update({ q: trimmed, page: 1 }), 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, q]);

  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0]!;

  const { data: classes } = useResource<ClassSummary[]>((token) => listClasses(token));

  const { data, state, error } = useResource<SubmissionPage>(
    (token) =>
      listSubmissionsPage(token, {
        page,
        limit: PAGE_SIZE,
        status: active.status ?? undefined,
        classId: classId === "all" ? undefined : classId,
        q: q || undefined,
      }),
    [page, active.status, classId, q],
  );

  // A filter change or a class with fewer rows can leave the page past the
  // end; step back to the last page that exists.
  useEffect(() => {
    if (data && page > data.totalPages) update({ page: data.totalPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, page]);

  const counts = data?.counts;
  const allCount = useMemo(
    () => (counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : null),
    [counts],
  );

  const sortedClasses = useMemo(
    () =>
      [...(classes ?? [])].sort((a, b) =>
        a.status === b.status ? a.name.localeCompare(b.name, "vi") : a.status === "active" ? -1 : 1,
      ),
    [classes],
  );

  const rows = data?.data ?? [];
  const hasFilters = filter !== "all" || classId !== "all" || q.length > 0;
  const firstRow = data && data.total > 0 ? (data.page - 1) * data.limit + 1 : 0;
  const lastRow = rows.length > 0 ? firstRow + rows.length - 1 : 0;

  const goToPage = (next: number) => {
    update({ page: next });
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const clearFilters = () => {
    setQuery("");
    update({ status: "all", class: "all", q: "", page: 1 });
  };

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
      <p className={s.subtitle}>Toàn bộ bài nộp của mọi bài tập, một chỗ để lọc theo lớp, tìm và mở từng bài.</p>

      <div className={v.toolbar}>
        <div className={v.tabs} role="group" aria-label="Lọc theo trạng thái">
          {FILTERS.map((f) => {
            const count = f.status ? counts?.[f.status] : allCount;
            if (f.hideWhenEmpty && count === 0 && f.id !== filter) return null;
            const selected = f.id === filter;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={selected}
                className={`${v.tab} ${selected ? v.tabActive : ""} ${
                  f.id === "failed" || f.id === "abuse" ? v.tabAlert : ""
                }`}
                onClick={() => update({ status: f.id, page: 1 })}
              >
                <span>{f.label}</span>
                {count !== undefined && count !== null ? <span className={v.tabCount}>{count}</span> : null}
              </button>
            );
          })}
        </div>

        <div className={v.controls}>
          <label className={v.control}>
            <span className={s.fieldLabel}>Lớp</span>
            <select
              className={s.paperFilterSelect}
              value={classId}
              onChange={(e) => update({ class: e.target.value, page: 1 })}
            >
              <option value="all">Tất cả lớp</option>
              {sortedClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.status === "archived" ? `${c.name} (lưu trữ)` : c.name}
                </option>
              ))}
              <option value={NO_CLASS}>Tất cả học viên (không lớp)</option>
            </select>
          </label>

          <label className={`${v.control} ${v.searchControl}`}>
            <span className={s.fieldLabel}>Tìm kiếm</span>
            <span className={v.search}>
              <span className={v.searchIcon} aria-hidden="true">
                ⌕
              </span>
              <input
                type="search"
                className={v.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tên, email học viên hoặc tên bài tập"
              />
              {query ? (
                <button
                  type="button"
                  className={v.searchClear}
                  onClick={() => setQuery("")}
                  aria-label="Xóa từ khóa"
                >
                  ×
                </button>
              ) : null}
            </span>
          </label>

          {hasFilters ? (
            <button type="button" className={v.reset} onClick={clearFilters}>
              Bỏ lọc
            </button>
          ) : null}
        </div>
      </div>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" && !data ? <WaitingRack /> : null}

      {data ? (
        <>
          <div className={v.summary}>
            <h2 className={s.sectionTitle}>{data.total} bài nộp</h2>
            {data.total > 0 ? (
              <span className={v.range}>
                {firstRow}–{lastRow} / {data.total}
              </span>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <Blank art="writing" title={hasFilters ? "Không có bài nộp nào khớp" : "Chưa có bài nộp nào"}>
              {hasFilters ? (
                <>
                  Đổi bộ lọc hoặc từ khóa.{" "}
                  <button type="button" className={v.inlineLink} onClick={clearFilters}>
                    Bỏ lọc
                  </button>
                </>
              ) : (
                "Khi học viên nộp bài, bài nộp sẽ xuất hiện ở đây."
              )}
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
                    row.assignment.class?.name ?? "Tất cả học viên",
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

          <Pager page={page} totalPages={data.totalPages} onPage={goToPage} label="Trang bài nộp" />
        </>
      ) : null}
    </Shell>
  );
}
