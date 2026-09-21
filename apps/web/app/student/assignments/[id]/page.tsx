"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TASK_TYPE_LABEL,
  type Assignment,
  type StudentSubmissionListRow,
  getAssignment,
  listAllSubmissions,
  submitEssay,
} from "../../../../lib/idest";
import { countWords, day } from "../../../../lib/format";
import { useAction, useResource } from "../../../../lib/use-api";
import { Blank, Notice, Shell, WaitingRack, board as s } from "../../../../components/board";

const MIN_WORDS = 10;
const MAX_WORDS = 1500;

type Loaded = { assignment: Assignment; latest: StudentSubmissionListRow | null };

export default function WriteEssay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, state, error } = useResource<Loaded>(
    async (token) => {
      const [assignment, mine] = await Promise.all([
        getAssignment(id, token),
        listAllSubmissions<StudentSubmissionListRow[]>(token),
      ]);
      const forThisAssignment = mine
        .filter((row) => row.assignmentId === id)
        .sort((a, b) => b.attemptNumber - a.attemptNumber);
      return { assignment, latest: forThisAssignment[0] ?? null };
    },
    [id],
  );
  // Mirrors the server's resubmission gate: a pending or abuse-flagged attempt
  // blocks a new one, unless it failed outright or a teacher opened a redo
  // request. Proactive here so the student never types a fresh essay only to
  // have the POST rejected.
  const blocked = Boolean(data?.latest && data.latest.status !== "failed" && !data.latest.openRedoRequest);
  const { busy, error: actionError, run } = useAction();

  const draftKey = `idest.draft.${id}`;
  const [essay, setEssay] = useState("");
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) {
        setEssay(saved);
        setRestored(true);
      }
    } catch {
      /* private mode — drafting still works, it just is not kept */
    }
  }, [draftKey]);

  useEffect(() => {
    if (!essay) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(draftKey, essay);
      } catch {
        /* nothing to do; the essay stays in the field */
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [essay, draftKey]);

  const words = useMemo(() => countWords(essay), [essay]);
  const tooShort = words > 0 && words < MIN_WORDS;
  const tooLong = words > MAX_WORDS;
  const canSubmit = words >= MIN_WORDS && !tooLong && !busy;

  const submit = useCallback(async () => {
    const made = await run((token) =>
      submitEssay(token, id, {
        essayText: essay.trim(),
        idempotencyKey: `${id}:${words}:${essay.trim().slice(0, 24)}`,
      }),
    );
    if (made) {
      try {
        window.localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      router.push(`/student/submissions/${made.id}`);
    }
  }, [run, id, essay, words, draftKey, router]);

  return (
    <Shell role="student">
      {state === "loading" ? <WaitingRack rows={2} /> : null}
      {state === "error" ? <Notice tone="alert">{error}</Notice> : null}

      {state === "ready" && data ? (
        <>
          <div className={s.slugLine}>
            <span className={s.slugRef}>{TASK_TYPE_LABEL[data.assignment.taskType]}</span>
            <h1 className={s.title} style={{ marginRight: "auto" }}>
              {data.assignment.title}
            </h1>
            <span className={s.slugMeta}>
              <span>hạn {day(data.assignment.dueAt)}</span>
              <span>
                {MIN_WORDS}–{MAX_WORDS} từ
              </span>
            </span>
          </div>

          <p className={s.prompt}>{data.assignment.taskPrompt}</p>
          {data.assignment.taskImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.assignment.taskImageUrl} alt="Biểu đồ/sơ đồ của đề bài" className={s.promptImage} />
          ) : null}

          {blocked ? (
            <Blank art="writing" title="Bạn đã nộp bài này">
              Đang chờ giáo viên xem lại. Bạn sẽ viết lại được nếu giáo viên yêu cầu.
            </Blank>
          ) : (
            <>
              {restored ? <Notice>Đã khôi phục bản nháp bạn viết dở trên máy này.</Notice> : null}

              <div className={s.fieldRow}>
                <label className={s.fieldLabel} htmlFor="essay">
                  Bài viết của bạn (tiếng Anh)
                </label>
                <textarea
                  id="essay"
                  className={s.field}
                  style={{
                    minHeight: "24rem",
                    fontFamily: "var(--font-essay)",
                    fontSize: "1.05rem",
                    lineHeight: 1.7,
                  }}
                  value={essay}
                  onChange={(e) => setEssay(e.target.value)}
                  placeholder="Some people believe that…"
                />
                <p className={s.fieldHint}>
                  <span className={s.figure}>{words}</span> từ · nháp được lưu trên máy bạn cho tới khi nộp
                </p>
              </div>

              {tooShort ? (
                <Notice tone="alert">Bài ngắn quá — cần ít nhất {MIN_WORDS} từ mới nộp được.</Notice>
              ) : null}
              {tooLong ? (
                <Notice tone="alert">
                  Bài dài quá — tối đa {MAX_WORDS} từ. Bỏ bớt {words - MAX_WORDS} từ rồi nộp lại.
                </Notice>
              ) : null}
              {actionError ? <Notice tone="alert">{actionError}</Notice> : null}

              <div className={s.actionRow}>
                <button type="button" className={s.press} disabled={!canSubmit} onClick={submit}>
                  {busy ? "Đang nộp…" : "Nộp bài"}
                </button>
                <span className={s.fieldHint}>
                  Nộp xong bài vào hàng chờ. Giáo viên đọc và duyệt trước khi bạn thấy điểm.
                </span>
              </div>
            </>
          )}
        </>
      ) : null}
    </Shell>
  );
}
