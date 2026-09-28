"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  type ClassPage,
  type ClassStatus,
  CLASS_STATUS_LABEL,
  createClass,
  listClassesPage,
} from "../../../lib/idest";
import { day } from "../../../lib/format";
import { useAction, useResource } from "../../../lib/use-api";
import { Blank, Notice, Pager, Shell, WaitingRack, Wizard, board as s } from "../../../components/board";
import v from "../../../components/list-toolbar.module.css";
import c from "./classes.module.css";

// The "Tạo lớp mới" ghost card takes the first cell of every page, so
// 11 cards + 1 ghost = 12 cells: full rows on the 4-, 2- and 1-column grids.
const PAGE_SIZE = 11;

const STATUS_TABS: Array<{ id: ClassStatus | "all"; label: string }> = [
  { id: "all", label: "Tất cả" },
  { id: "active", label: CLASS_STATUS_LABEL.active },
  { id: "archived", label: CLASS_STATUS_LABEL.archived },
];

export default function ClassesPage() {
  const [statusFilter, setStatusFilter] = useState<ClassStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [query]);

  const { data, state, error, reload } = useResource<ClassPage>(
    (token) =>
      listClassesPage(token, {
        page,
        limit: PAGE_SIZE,
        status: statusFilter === "all" ? undefined : statusFilter,
        q: debouncedQuery || undefined,
      }),
    [page, statusFilter, debouncedQuery],
  );

  // Archiving from another tab or a narrower search can leave the page past
  // the end; step back to the last page that exists.
  useEffect(() => {
    if (data && page > data.totalPages) setPage(data.totalPages);
  }, [data, page]);

  const { busy, error: createError, run } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const create = useCallback(async () => {
    if (!name.trim()) {
      setFormError("Cần tên lớp.");
      return;
    }
    setFormError(null);
    const made = await run((token) =>
      createClass(token, { name: name.trim(), description: description.trim() || undefined }),
    );
    if (made) {
      setName("");
      setDescription("");
      setOpen(false);
      await reload();
    }
  }, [name, description, run, reload]);

  const goToPage = (next: number) => {
    setPage(next);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  };

  const clearFilters = () => {
    setStatusFilter("all");
    setQuery("");
    setDebouncedQuery("");
    setPage(1);
  };

  const counts = data?.counts;
  const allCount = counts ? counts.active + counts.archived : null;
  const hasFilters = statusFilter !== "all" || debouncedQuery.length > 0;

  return (
    <Shell role="teacher" wide>
      <div className={s.slugLine}>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          Lớp học
        </h1>
        <Link href="/teacher" className={s.pressQuiet}>
          ← Tổng quan
        </Link>
      </div>
      <p className={s.subtitle}>
        Mỗi lớp là một nhóm học viên của bạn. Bài tập có thể giao riêng cho một lớp, hoặc để mở cho tất cả học viên.
      </p>

      <div className={v.toolbar}>
        <div className={v.tabs} role="group" aria-label="Lọc theo trạng thái">
          {STATUS_TABS.map((tab) => {
            const count = tab.id === "all" ? allCount : counts?.[tab.id];
            const selected = tab.id === statusFilter;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={selected}
                className={`${v.tab} ${selected ? v.tabActive : ""}`}
                onClick={() => {
                  setStatusFilter(tab.id);
                  setPage(1);
                }}
              >
                <span>{tab.label}</span>
                {count !== undefined && count !== null ? <span className={v.tabCount}>{count}</span> : null}
              </button>
            );
          })}
        </div>
        <div className={v.controls}>
          <label className={`${v.control} ${v.searchControl}`}>
            <span className={s.fieldLabel}>Tìm lớp</span>
            <span className={v.search}>
              <span className={v.searchIcon} aria-hidden="true">
                ⌕
              </span>
              <input
                type="search"
                className={v.searchInput}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Tên lớp"
              />
              {query ? (
                <button type="button" className={v.searchClear} onClick={() => setQuery("")} aria-label="Xóa từ khóa">
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

      <Wizard
        open={open}
        onClose={() => setOpen(false)}
        title="Tạo lớp mới"
        footer={
          <>
            <button type="button" className={s.pressQuiet} onClick={() => setOpen(false)}>
              Hủy
            </button>
            <button type="button" className={s.press} disabled={busy} onClick={create}>
              {busy ? "Đang tạo…" : "Tạo lớp"}
            </button>
          </>
        }
      >
        <div className={s.fieldRow}>
          <label className={s.fieldLabel} htmlFor="c-name">
            Tên lớp
          </label>
          <input
            id="c-name"
            className={s.field}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="IELTS Writing — Lớp tối T3/T5"
            autoFocus
          />
        </div>
        <div className={s.fieldRow}>
          <label className={s.fieldLabel} htmlFor="c-desc">
            Mô tả (tùy chọn)
          </label>
          <textarea
            id="c-desc"
            className={s.field}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {formError ? <Notice tone="alert">{formError}</Notice> : null}
        {createError ? <Notice tone="alert">{createError}</Notice> : null}
      </Wizard>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" && !data ? <WaitingRack /> : null}

      {data ? (
        <>
          <div className={v.summary}>
            <h2 className={s.sectionTitle}>{data.total} lớp</h2>
            {data.total > 0 ? (
              <span className={v.range}>
                Trang {data.page} / {data.totalPages}
              </span>
            ) : null}
          </div>

          <div className={s.paperGrid}>
            <button type="button" className={s.paperGhost} data-tour="create-class" onClick={() => setOpen(true)}>
              <span className={s.paperGhostIcon} aria-hidden="true">
                +
              </span>
              <span className={s.paperGhostLabel}>Tạo lớp mới</span>
            </button>

            {data.data.map((klass) => (
              <Link
                key={klass.id}
                href={`/teacher/classes/${klass.id}`}
                className={`${s.paperCard} ${c.classCard} ${klass.status === "archived" ? c.classCardArchived : ""}`}
              >
                <span
                  className={klass.status === "active" ? s.paperStamp : `${s.paperStamp} ${s.paperStampQuiet}`}
                  style={{ marginTop: 0 }}
                >
                  {CLASS_STATUS_LABEL[klass.status]}
                </span>
                <span className={s.paperTitle}>{klass.name}</span>
                <span className={c.classDesc}>{klass.description || "Chưa có mô tả."}</span>
                <span className={c.classStats}>
                  <span className={c.classStat}>
                    <span className={c.classStatFigure}>{klass.memberCount ?? 0}</span>
                    <span className={c.classStatLabel}>học viên</span>
                  </span>
                  <span className={c.classStat}>
                    <span className={c.classStatFigure}>{klass.assignmentCount ?? 0}</span>
                    <span className={c.classStatLabel}>bài tập</span>
                  </span>
                </span>
                <span className={c.classFoot}>
                  <span>tạo {day(klass.createdAt)}</span>
                  <span className={c.classGo} aria-hidden="true">
                    Mở lớp →
                  </span>
                </span>
              </Link>
            ))}
          </div>

          {data.data.length === 0 && hasFilters ? (
            <Blank art="reading" title="Không có lớp nào khớp bộ lọc">
              Đổi trạng thái hoặc từ khóa.{" "}
              <button type="button" className={v.inlineLink} onClick={clearFilters}>
                Bỏ lọc
              </button>
            </Blank>
          ) : null}

          <Pager page={page} totalPages={data.totalPages} onPage={goToPage} label="Trang lớp học" />
        </>
      ) : null}
    </Shell>
  );
}
