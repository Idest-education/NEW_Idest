"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ASSIGNMENT_STATUS_LABEL,
  type Assignment,
  type AssignmentPage,
  type AssignmentStatus,
  type ClassSummary,
  type TaskType,
  TASK_TYPE_LABEL,
  createAssignment,
  deleteAssignment,
  deleteAssignmentImage,
  listAssignmentsPage,
  listClasses,
  updateAssignment,
  updateAssignmentStatus,
  uploadAssignmentImage,
} from "../../../lib/idest";
import { day, fileSize } from "../../../lib/format";
import { useAction, useResource } from "../../../lib/use-api";
import { Blank, ImageDropzone, Notice, Shell, WaitingRack, Wizard, board as s } from "../../../components/board";

const WIZARD_STEPS = ["Nội dung", "Lịch & lớp"];

const PAGE_SIZE = 8;

export default function AssignmentsPage() {
  const [statusFilter, setStatusFilter] = useState<AssignmentStatus | "all">("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskType | "all">("all");
  const [classFilter, setClassFilter] = useState("all");
  const [page, setPage] = useState(1);

  const { data: classes } = useResource<ClassSummary[]>((token) => listClasses(token));

  const { data, state, error, reload } = useResource<AssignmentPage>(
    (token) =>
      listAssignmentsPage(token, {
        page,
        limit: PAGE_SIZE,
        status: statusFilter === "all" ? undefined : statusFilter,
        taskType: taskTypeFilter === "all" ? undefined : taskTypeFilter,
        classId: classFilter === "all" ? undefined : classFilter,
      }),
    [page, statusFilter, taskTypeFilter, classFilter],
  );

  const hasFilters = statusFilter !== "all" || taskTypeFilter !== "all" || classFilter !== "all";

  return (
    <Shell role="teacher" wide>
      <div className={s.slugLine}>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          Bài tập
        </h1>
        <Link href="/teacher" className={s.pressQuiet}>
          ← Tổng quan
        </Link>
      </div>
      <p className={s.subtitle}>
        Tạo bài tập, ghim một bài nổi bật cho học viên, đặt hạn nộp, hoặc đóng/xóa bài tập đã cũ.
      </p>

      <div className={s.stickyNote}>
        <span className={s.stickyNotePin} aria-hidden="true" />
        Thầy cô nhớ ấn &quot;Mở bài tập&quot; để học sinh thấy nhé!
      </div>

      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}
      {state === "loading" ? <WaitingRack /> : null}

      {state === "ready" && data ? (
        <AssignmentsBody
          assignmentPage={data}
          classes={classes ?? []}
          hasFilters={hasFilters}
          statusFilter={statusFilter}
          taskTypeFilter={taskTypeFilter}
          classFilter={classFilter}
          page={page}
          onStatusFilter={(v) => {
            setStatusFilter(v);
            setPage(1);
          }}
          onTaskTypeFilter={(v) => {
            setTaskTypeFilter(v);
            setPage(1);
          }}
          onClassFilter={(v) => {
            setClassFilter(v);
            setPage(1);
          }}
          onPage={setPage}
          onChanged={reload}
        />
      ) : null}
    </Shell>
  );
}

function AssignmentsBody({
  assignmentPage,
  classes,
  hasFilters,
  statusFilter,
  taskTypeFilter,
  classFilter,
  page,
  onStatusFilter,
  onTaskTypeFilter,
  onClassFilter,
  onPage,
  onChanged,
}: {
  assignmentPage: AssignmentPage;
  classes: ClassSummary[];
  hasFilters: boolean;
  statusFilter: AssignmentStatus | "all";
  taskTypeFilter: TaskType | "all";
  classFilter: string;
  page: number;
  onStatusFilter: (v: AssignmentStatus | "all") => void;
  onTaskTypeFilter: (v: TaskType | "all") => void;
  onClassFilter: (v: string) => void;
  onPage: (v: number) => void;
  onChanged: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("task_2");
  const [dueAt, setDueAt] = useState("");
  const [classId, setClassId] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const imagePreviewUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const assignments = assignmentPage.data;
  const totalPages = assignmentPage.totalPages;
  const editingAssignment = assignments.find((a) => a.id === editingId) ?? null;

  const openWizard = useCallback(() => {
    setStep(0);
    setFormError(null);
    setImageFile(null);
    setOpen(true);
  }, []);

  const closeWizard = useCallback(() => {
    setOpen(false);
  }, []);

  const goNext = useCallback(() => {
    if (!title.trim() || !taskPrompt.trim()) {
      setFormError("Cần tiêu đề và đề bài trước khi tạo.");
      return;
    }
    if (taskType === "task_1" && !imageFile) {
      setFormError("Task 1 cần có ảnh biểu đồ/sơ đồ minh họa.");
      return;
    }
    setFormError(null);
    setStep(1);
  }, [title, taskPrompt, taskType, imageFile]);

  const create = useCallback(async () => {
    if (!title.trim() || !taskPrompt.trim()) {
      setFormError("Cần tiêu đề và đề bài trước khi tạo.");
      setStep(0);
      return;
    }
    if (taskType === "task_1" && !imageFile) {
      setFormError("Task 1 cần có ảnh biểu đồ/sơ đồ minh họa.");
      setStep(0);
      return;
    }
    setFormError(null);
    const made = await run(async (token) => {
      const assignment = await createAssignment(token, {
        title: title.trim(),
        taskPrompt: taskPrompt.trim(),
        taskType,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        classId: classId || undefined,
      });
      if (imageFile) {
        return uploadAssignmentImage(token, assignment.id, imageFile);
      }
      return assignment;
    });
    if (made) {
      setTitle("");
      setTaskPrompt("");
      setDueAt("");
      setClassId("");
      setImageFile(null);
      setOpen(false);
      await onChanged();
    }
  }, [title, taskPrompt, taskType, dueAt, classId, imageFile, run, onChanged]);

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
        <h2 className={s.sectionTitle}>{assignmentPage.total} bài tập</h2>
      </div>

      <Wizard
        open={open}
        onClose={closeWizard}
        title="Giao bài tập mới"
        steps={WIZARD_STEPS}
        step={step}
        footer={
          step === 0 ? (
            <>
              <button type="button" className={s.pressQuiet} onClick={closeWizard}>
                Hủy
              </button>
              <button type="button" className={s.press} onClick={goNext}>
                Tiếp theo →
              </button>
            </>
          ) : (
            <>
              <button type="button" className={s.pressQuiet} onClick={() => setStep(0)}>
                ← Quay lại
              </button>
              <button type="button" className={s.press} onClick={create} disabled={busy}>
                {busy ? "Đang tạo…" : "Tạo bài tập (bản nháp)"}
              </button>
            </>
          )
        }
      >
        {step === 0 ? (
          <>
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
                autoFocus
              />
            </div>
            <div className={s.fieldRow}>
              <label className={s.fieldLabel} htmlFor="a-type">
                Dạng bài
              </label>
              <select
                id="a-type"
                className={s.field}
                value={taskType}
                onChange={(e) => {
                  const next = e.target.value as TaskType;
                  setTaskType(next);
                  if (next === "task_2") setImageFile(null);
                }}
              >
                <option value="task_2">Task 2</option>
                <option value="task_1">Task 1</option>
              </select>
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
            {taskType === "task_1" ? (
              <div className={s.fieldRow}>
                <label className={s.fieldLabel} htmlFor="a-image">
                  Ảnh biểu đồ/sơ đồ
                </label>
                <ImageDropzone
                  id="a-image"
                  previewUrl={imagePreviewUrl}
                  status={imageFile ? "staged" : "empty"}
                  fileName={imageFile?.name}
                  fileSize={imageFile ? fileSize(imageFile.size) : undefined}
                  onSelect={setImageFile}
                  onClear={() => setImageFile(null)}
                />
              </div>
            ) : null}
            {formError ? <Notice tone="alert">{formError}</Notice> : null}
          </>
        ) : (
          <>
            <div className={s.fieldRow}>
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
            <div className={s.fieldRow}>
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
            <span className={s.fieldHint}>Bài tập mới ở trạng thái nháp; mở bài tập thì học viên mới nộp được.</span>
            {error ? <Notice tone="alert">{error}</Notice> : null}
          </>
        )}
      </Wizard>

      {assignmentPage.total > 0 || hasFilters ? (
        <div className={s.paperFilters}>
          <label className={s.paperFilterField}>
            <span className={s.fieldLabel}>Trạng thái</span>
            <select
              className={s.paperFilterSelect}
              value={statusFilter}
              onChange={(e) => onStatusFilter(e.target.value as AssignmentStatus | "all")}
            >
              <option value="all">Tất cả</option>
              {(Object.keys(ASSIGNMENT_STATUS_LABEL) as AssignmentStatus[]).map((st) => (
                <option key={st} value={st}>
                  {ASSIGNMENT_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>
          <label className={s.paperFilterField}>
            <span className={s.fieldLabel}>Dạng bài</span>
            <select
              className={s.paperFilterSelect}
              value={taskTypeFilter}
              onChange={(e) => onTaskTypeFilter(e.target.value as TaskType | "all")}
            >
              <option value="all">Tất cả</option>
              <option value="task_1">Task 1</option>
              <option value="task_2">Task 2</option>
            </select>
          </label>
          <label className={s.paperFilterField}>
            <span className={s.fieldLabel}>Lớp</span>
            <select
              className={s.paperFilterSelect}
              value={classFilter}
              onChange={(e) => onClassFilter(e.target.value)}
            >
              <option value="all">Tất cả</option>
              <option value="none">Tất cả học viên (không lớp)</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className={s.paperGrid}>
        <button type="button" className={s.paperGhost} onClick={openWizard}>
          <span className={s.paperGhostIcon} aria-hidden="true">
            +
          </span>
          <span className={s.paperGhostLabel}>Giao bài tập mới</span>
        </button>

        {assignments.map((assignment) => (
          <div key={assignment.id} className={s.paperCard}>
            <div className={s.paperCardHead}>
              <span className={s.paperTag}>{TASK_TYPE_LABEL[assignment.taskType]}</span>
              {assignment.highlighted ? (
                <span className={s.paperStar} aria-hidden="true">
                  ★
                </span>
              ) : null}
            </div>

            <Link href={`/teacher/assignments/${assignment.id}`} className={s.paperTitle}>
              {assignment.title}
            </Link>

            <span
              className={
                assignment.status === "active" ? s.paperStamp : `${s.paperStamp} ${s.paperStampQuiet}`
              }
            >
              {ASSIGNMENT_STATUS_LABEL[assignment.status]}
            </span>

            <ul className={s.paperMeta}>
              <li>hạn {day(assignment.dueAt)}</li>
              <li>{assignment.class?.name ?? "Tất cả học viên"}</li>
              <li>{assignment.submissionCount ?? 0} bài nộp</li>
            </ul>

            <div className={s.paperTear}>
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
            </div>
          </div>
        ))}
      </div>

      {assignments.length === 0 && hasFilters ? (
        <Blank art="reading" title="Không có bài tập nào khớp bộ lọc">
          Thử đổi trạng thái, dạng bài hoặc lớp ở trên.
        </Blank>
      ) : null}

      {totalPages > 1 ? (
        <div className={s.pager}>
          <button type="button" className={s.pressQuiet} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            ← Trước
          </button>
          <span className={s.pagerInfo}>
            Trang {page} / {totalPages}
          </span>
          <button
            type="button"
            className={s.pressQuiet}
            disabled={page >= totalPages}
            onClick={() => onPage(page + 1)}
          >
            Sau →
          </button>
        </div>
      ) : null}

      {editingAssignment ? (
        <EditAssignmentRow
          assignment={editingAssignment}
          classes={classes}
          onClose={() => setEditingId(null)}
          onDone={async () => {
            setEditingId(null);
            await onChanged();
          }}
          onImageChanged={onChanged}
          onDelete={() => remove(editingAssignment.id)}
        />
      ) : null}
    </>
  );
}

function EditAssignmentRow({
  assignment,
  classes,
  onClose,
  onDone,
  onImageChanged,
  onDelete,
}: {
  assignment: Assignment;
  classes: ClassSummary[];
  onClose: () => void;
  onDone: () => Promise<void>;
  onImageChanged: () => Promise<void>;
  onDelete: () => void;
}) {
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState(assignment.title);
  const [taskPrompt, setTaskPrompt] = useState(assignment.taskPrompt);
  const [dueAt, setDueAt] = useState(assignment.dueAt ? assignment.dueAt.slice(0, 16) : "");
  const [classId, setClassId] = useState(assignment.classId ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [imageState, setImageState] = useState<"idle" | "uploading" | "error">("idle");
  const [imageError, setImageError] = useState<string | null>(null);

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

  const handleImageSelect = async (file: File) => {
    setImageState("uploading");
    setImageError(null);
    const done = await run((token) => uploadAssignmentImage(token, assignment.id, file));
    if (done) {
      setImageState("idle");
      await onImageChanged();
    } else {
      setImageState("error");
      setImageError("Tải ảnh lên thất bại — thử lại.");
    }
  };

  const handleImageClear = async () => {
    setImageState("uploading");
    setImageError(null);
    const done = await run((token) => deleteAssignmentImage(token, assignment.id));
    if (done) {
      setImageState("idle");
      await onImageChanged();
    } else {
      setImageState("error");
      setImageError("Xóa ảnh thất bại — thử lại.");
    }
  };

  return (
    <Wizard
      open
      onClose={onClose}
      title="Sửa bài tập"
      footer={
        <>
          <button type="button" className={s.pressQuiet} onClick={onClose}>
            Hủy
          </button>
          <button type="button" className={s.press} disabled={busy} onClick={save}>
            {busy ? "Đang lưu…" : "Lưu thay đổi"}
          </button>
        </>
      }
    >
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
      {assignment.taskType === "task_1" ? (
        <div className={s.fieldRow}>
          <label className={s.fieldLabel} htmlFor={`e-image-${assignment.id}`}>
            Ảnh biểu đồ/sơ đồ
          </label>
          <ImageDropzone
            id={`e-image-${assignment.id}`}
            previewUrl={assignment.taskImageUrl ?? null}
            status={
              imageState === "uploading"
                ? "uploading"
                : imageState === "error"
                  ? "error"
                  : assignment.taskImageUrl
                    ? "uploaded"
                    : "empty"
            }
            errorMessage={imageError ?? undefined}
            disabled={imageState === "uploading"}
            onSelect={handleImageSelect}
            onClear={assignment.taskImageUrl ? handleImageClear : undefined}
          />
        </div>
      ) : null}
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
    </Wizard>
  );
}
