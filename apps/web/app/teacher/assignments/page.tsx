"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ASSIGNMENT_STATUS_LABEL,
  type Assignment,
  type AssignmentStatus,
  type ClassSummary,
  type TaskType,
  TASK_TYPE_LABEL,
  createAssignment,
  deleteAssignment,
  listAssignments,
  listClasses,
  updateAssignment,
  updateAssignmentStatus,
} from "../../../lib/idest";
import { day } from "../../../lib/format";
import { useAction, useResource } from "../../../lib/use-api";
import { Blank, Notice, Shell, WaitingRack, board as s } from "../../../components/board";

type Loaded = { assignments: Assignment[]; classes: ClassSummary[] };

export default function AssignmentsPage() {
  const { data, state, error, reload } = useResource<Loaded>(async (token) => ({
    assignments: await listAssignments(token),
    classes: await listClasses(token),
  }));

  return (
    <Shell role="teacher" wide>
      <div className={s.slugLine}>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          Bài tập
        </h1>
        <Link href="/teacher" className={s.navLink}>
          ← Tổng quan
        </Link>
      </div>
      <p className={s.subtitle}>
        Tạo bài tập, ghim một bài nổi bật cho học viên, đặt hạn nộp, hoặc đóng/xóa bài tập đã cũ.
      </p>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" ? <WaitingRack /> : null}

      {state === "ready" && data ? (
        <AssignmentsBody assignments={data.assignments} classes={data.classes} onChanged={reload} />
      ) : null}
    </Shell>
  );
}

function AssignmentsBody({
  assignments,
  classes,
  onChanged,
}: {
  assignments: Assignment[];
  classes: ClassSummary[];
  onChanged: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("task_2");
  const [dueAt, setDueAt] = useState("");
  const [classId, setClassId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const create = useCallback(async () => {
    if (!title.trim() || !taskPrompt.trim()) {
      setFormError("Cần tiêu đề và đề bài trước khi tạo.");
      return;
    }
    setFormError(null);
    const made = await run((token) =>
      createAssignment(token, {
        title: title.trim(),
        taskPrompt: taskPrompt.trim(),
        taskType,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        classId: classId || undefined,
      }),
    );
    if (made) {
      setTitle("");
      setTaskPrompt("");
      setDueAt("");
      setClassId("");
      setOpen(false);
      await onChanged();
    }
  }, [title, taskPrompt, taskType, dueAt, classId, run, onChanged]);

  const setStatus = useCallback(
    async (id: string, status: AssignmentStatus) => {
      const done = await run((token) => updateAssignmentStatus(token, id, status));
      if (done) await onChanged();
    },
    [run, onChanged],
  );

  const toggleHighlight = useCallback(
    async (id: string, next: boolean) => {
      const done = await run((token) => updateAssignment(token, id, { highlighted: next }));
      if (done) await onChanged();
    },
    [run, onChanged],
  );

  const remove = useCallback(
    async (id: string) => {
      const done = await run((token) => deleteAssignment(token, id));
      if (done) await onChanged();
    },
    [run, onChanged],
  );

  return (
    <>
      <div className={s.sectionHead}>
        <h2 className={s.sectionTitle}>{assignments.length} bài tập</h2>
        <button type="button" className={s.press} onClick={() => setOpen((v) => !v)}>
          {open ? "Đóng" : "Giao bài tập mới"}
        </button>
      </div>

      {open ? (
        <div className={s.railBlock}>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel} htmlFor="a-title">
              Tiêu đề
            </label>
            <input
              id="a-title"
              className={s.field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="IELTS Task 2 — Universities & the workplace"
            />
          </div>
          <div className={s.fieldRow}>
            <label className={s.fieldLabel} htmlFor="a-prompt">
              Đề bài (tiếng Anh)
            </label>
            <textarea
              id="a-prompt"
              className={s.field}
              rows={4}
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              placeholder="Some people think that universities should…"
            />
          </div>
          <div className={s.actionRow}>
            <div>
              <label className={s.fieldLabel} htmlFor="a-type">
                Dạng bài
              </label>
              <select
                id="a-type"
                className={s.field}
                value={taskType}
                onChange={(e) => setTaskType(e.target.value as TaskType)}
              >
                <option value="task_2">Task 2</option>
                <option value="task_1">Task 1</option>
              </select>
            </div>
            <div>
              <label className={s.fieldLabel} htmlFor="a-due">
                Hạn nộp (tùy chọn)
              </label>
              <input
                id="a-due"
                className={s.field}
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div>
              <label className={s.fieldLabel} htmlFor="a-class">
                Lớp (tùy chọn)
              </label>
              <select
                id="a-class"
                className={s.field}
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                <option value="">Tất cả học viên</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {formError ? <Notice tone="alert">{formError}</Notice> : null}
          {error ? <Notice tone="alert">{error}</Notice> : null}
          <div className={s.actionRow}>
            <button type="button" className={s.press} onClick={create} disabled={busy}>
              {busy ? "Đang tạo…" : "Tạo bài tập (bản nháp)"}
            </button>
            <span className={s.fieldHint}>Bài tập mới ở trạng thái nháp; mở bài tập thì học viên mới nộp được.</span>
          </div>
        </div>
      ) : null}

      {assignments.length === 0 ? (
        <Blank art="reading" title="Chưa có bài tập nào">
          Giao một bài tập rồi mở nó, học viên của bạn sẽ nộp bài vào đúng bài tập đó.
        </Blank>
      ) : (
        <div className={s.rack}>
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className={s.strip}
              style={{ display: "flex", flexDirection: "column", alignItems: "stretch" }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "7.5rem minmax(0,1fr) auto", gap: "0.5rem 1rem", alignItems: "center", width: "100%" }}>
                <span className={s.stripRef}>{TASK_TYPE_LABEL[assignment.taskType]}</span>
                <span className={s.stripBody}>
                  <Link href={`/teacher/assignments/${assignment.id}`} className={s.stripName}>
                    {assignment.title}
                    {assignment.highlighted ? " ★" : ""}
                  </Link>
                  <span className={s.stripMeta}>
                    <span>{ASSIGNMENT_STATUS_LABEL[assignment.status]}</span>
                    <span>hạn {day(assignment.dueAt)}</span>
                    <span>{assignment.class?.name ?? "Tất cả học viên"}</span>
                    <span>{assignment.submissionCount ?? 0} bài nộp</span>
                  </span>
                </span>
                <span className={s.stripEnd}>
                  <button
                    type="button"
                    className={s.pressQuiet}
                    disabled={busy}
                    onClick={() => toggleHighlight(assignment.id, !assignment.highlighted)}
                  >
                    {assignment.highlighted ? "Bỏ ghim" : "Ghim nổi bật"}
                  </button>
                  {assignment.status !== "active" ? (
                    <button
                      type="button"
                      className={s.pressQuiet}
                      disabled={busy}
                      onClick={() => setStatus(assignment.id, "active")}
                    >
                      Mở bài tập
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={s.pressQuiet}
                      disabled={busy}
                      onClick={() => setStatus(assignment.id, "closed")}
                    >
                      Đóng bài tập
                    </button>
                  )}
                  <button
                    type="button"
                    className={s.pressQuiet}
                    disabled={busy}
                    onClick={() => setEditingId(editingId === assignment.id ? null : assignment.id)}
                  >
                    Sửa
                  </button>
                </span>
              </div>

              {editingId === assignment.id ? (
                <EditAssignmentRow
                  assignment={assignment}
                  classes={classes}
                  onDone={async () => {
                    setEditingId(null);
                    await onChanged();
                  }}
                  onDelete={() => remove(assignment.id)}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function EditAssignmentRow({
  assignment,
  classes,
  onDone,
  onDelete,
}: {
  assignment: Assignment;
  classes: ClassSummary[];
  onDone: () => Promise<void>;
  onDelete: () => void;
}) {
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState(assignment.title);
  const [taskPrompt, setTaskPrompt] = useState(assignment.taskPrompt);
  const [dueAt, setDueAt] = useState(assignment.dueAt ? assignment.dueAt.slice(0, 16) : "");
  const [classId, setClassId] = useState(assignment.classId ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    const done = await run((token) =>
      updateAssignment(token, assignment.id, {
        title: title.trim(),
        taskPrompt: taskPrompt.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        classId: classId || null,
      }),
    );
    if (done) await onDone();
  };

  return (
    <div className={s.commit} style={{ marginTop: "0.75rem" }}>
      <p className={s.commitHead}>Sửa bài tập</p>
      <div className={s.fieldRow}>
        <label className={s.fieldLabel} htmlFor={`e-title-${assignment.id}`}>
          Tiêu đề
        </label>
        <input
          id={`e-title-${assignment.id}`}
          className={s.field}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className={s.fieldRow}>
        <label className={s.fieldLabel} htmlFor={`e-prompt-${assignment.id}`}>
          Đề bài
        </label>
        <textarea
          id={`e-prompt-${assignment.id}`}
          className={s.field}
          rows={3}
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
        />
      </div>
      <div className={s.actionRow}>
        <div>
          <label className={s.fieldLabel} htmlFor={`e-due-${assignment.id}`}>
            Hạn nộp
          </label>
          <input
            id={`e-due-${assignment.id}`}
            className={s.field}
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </div>
        <div>
          <label className={s.fieldLabel} htmlFor={`e-class-${assignment.id}`}>
            Lớp
          </label>
          <select
            id={`e-class-${assignment.id}`}
            className={s.field}
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            <option value="">Tất cả học viên</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error ? <Notice tone="alert">{error}</Notice> : null}
      <div className={s.actionRow}>
        <button type="button" className={s.press} disabled={busy} onClick={save}>
          {busy ? "Đang lưu…" : "Lưu thay đổi"}
        </button>
        {confirmDelete ? (
          <>
            <span className={s.fieldHint}>Xóa hẳn đề này? Bài nộp cũ vẫn được giữ nguyên.</span>
            <button type="button" className={s.pressQuiet} disabled={busy} onClick={onDelete}>
              Xác nhận xóa
            </button>
            <button type="button" className={s.pressQuiet} onClick={() => setConfirmDelete(false)}>
              Thôi
            </button>
          </>
        ) : (
          <button type="button" className={s.pressQuiet} onClick={() => setConfirmDelete(true)}>
            Xóa bài tập
          </button>
        )}
      </div>
    </div>
  );
}
