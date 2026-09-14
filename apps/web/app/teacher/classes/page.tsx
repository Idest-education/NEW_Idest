"use client";

import { useCallback, useState } from "react";
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
import { Blank, Notice, Shell, WaitingRack, Wizard, board as s } from "../../../components/board";

const PAGE_SIZE = 12;

export default function ClassesPage() {
  const [statusFilter, setStatusFilter] = useState<ClassStatus | "all">("all");
  const [page, setPage] = useState(1);

  const { data, state, error, reload } = useResource<ClassPage>(
    (token) =>
      listClassesPage(token, {
        page,
        limit: PAGE_SIZE,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
    [page, statusFilter],
  );

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

  const hasFilters = statusFilter !== "all";

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
        Mỗi lớp là một nhóm học viên của bạn. Bài tập có thể giao riêng cho một lớp, hoặc để mở cho
        tất cả học viên.
      </p>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" ? <WaitingRack /> : null}

      {state === "ready" && data ? (
        <>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>{data.total} lớp</h2>
          </div>

          {data.total > 0 || hasFilters ? (
            <div className={s.paperFilters}>
              <label className={s.paperFilterField}>
                <span className={s.fieldLabel}>Trạng thái</span>
                <select
                  className={s.paperFilterSelect}
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as ClassStatus | "all");
                    setPage(1);
                  }}
                >
                  <option value="all">Tất cả</option>
                  {(Object.keys(CLASS_STATUS_LABEL) as ClassStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {CLASS_STATUS_LABEL[st]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

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

          <div className={s.rack}>
            <button type="button" className={s.ghostStrip} onClick={() => setOpen(true)}>
              <span aria-hidden="true">+</span> Tạo lớp mới
            </button>

            {data.data.map((klass) => (
              <Link key={klass.id} href={`/teacher/classes/${klass.id}`} className={s.strip}>
                <span className={s.stripRef}>{CLASS_STATUS_LABEL[klass.status]}</span>
                <span className={s.stripBody}>
                  <span className={s.stripName}>{klass.name}</span>
                  <span className={s.stripMeta}>
                    <span>{klass.memberCount ?? 0} học viên</span>
                    <span>{klass.assignmentCount ?? 0} bài tập</span>
                    <span>tạo {day(klass.createdAt)}</span>
                  </span>
                </span>
                <span className={s.stripEnd}>
                  <span className={s.stripState}>Xem lớp</span>
                </span>
              </Link>
            ))}
          </div>

          {data.data.length === 0 && hasFilters ? (
            <Blank art="reading" title="Không có lớp nào khớp bộ lọc">
              Thử đổi trạng thái ở trên.
            </Blank>
          ) : null}

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
