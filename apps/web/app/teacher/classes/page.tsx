"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { type ClassSummary, CLASS_STATUS_LABEL, createClass, listClasses } from "../../../lib/idest";
import { day } from "../../../lib/format";
import { useAction, useResource } from "../../../lib/use-api";
import { Blank, Notice, Shell, WaitingRack, board as s } from "../../../components/board";

export default function ClassesPage() {
  const { data, state, error, reload } = useResource<ClassSummary[]>((token) => listClasses(token));
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

  return (
    <Shell role="teacher" wide>
      <div className={s.slugLine}>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          Lớp học
        </h1>
        <Link href="/teacher" className={s.navLink}>
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
            <h2 className={s.sectionTitle}>{data.length} lớp</h2>
            <button type="button" className={s.press} onClick={() => setOpen((v) => !v)}>
              {open ? "Đóng" : "Tạo lớp mới"}
            </button>
          </div>

          {open ? (
            <div className={s.railBlock}>
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
              <div className={s.actionRow}>
                <button type="button" className={s.press} disabled={busy} onClick={create}>
                  {busy ? "Đang tạo…" : "Tạo lớp"}
                </button>
              </div>
            </div>
          ) : null}

          {data.length === 0 ? (
            <Blank art="reading" title="Chưa có lớp nào">
              Tạo một lớp rồi thêm học viên bằng email hoặc liên kết mời.
            </Blank>
          ) : (
            <div className={s.rack}>
              {data.map((klass) => (
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
          )}
        </>
      ) : null}
    </Shell>
  );
}
