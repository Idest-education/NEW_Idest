"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  INSTRUMENT_VERSION,
  itemsFor,
  sectionTitle,
  sectionsFor,
  validateAnswers,
  type AnswerError,
  type AnswerErrorReason,
  type Answers,
} from "@repo/feedback-contract";
import {
  getFeedback,
  getProfile,
  saveFeedback,
  type FeedbackResponseView,
  type FeedbackState,
  type Profile,
} from "../../lib/idest";
import {
  clearDraft,
  draftKey,
  errorText,
  firstErrorCode,
  initialAnswers,
  progress,
  readDraft,
  SURVEY_MINUTES,
  writeDraft,
} from "../../lib/feedback";
import { stamp } from "../../lib/format";
import { useAction, useResource } from "../../lib/use-api";
import { Notice, Shell, board as s } from "../../components/board";
import { SurveyItemField } from "../../components/survey-item";
import f from "../../components/survey.module.css";

export default function FeedbackPage() {
  const profile = useResource<Profile>((token) => getProfile(token));
  const feedback = useResource<FeedbackState>((token) => getFeedback(token));
  const role = profile.data?.role;
  const failed = profile.state === "error" || feedback.state === "error";

  const saved = (response: FeedbackResponseView) => {
    if (feedback.data) feedback.setData({ ...feedback.data, response, prompt: false });
  };

  return (
    <Shell role={role}>
      <h1 className={s.title}>Góp ý cho Idest</h1>
      {role === "admin" ? (
        <Notice>Khảo sát này dành cho giáo viên và học viên. Dữ liệu khảo sát tải ở trang Phân tích.</Notice>
      ) : failed ? (
        <>
          <Notice tone="alert">{feedback.error ?? profile.error}</Notice>
          <button
            type="button"
            className={s.pressQuiet}
            onClick={() => {
              void profile.reload();
              void feedback.reload();
            }}
          >
            Thử lại
          </button>
        </>
      ) : profile.data && feedback.data ? (
        <SurveyForm userId={profile.data.id} state={feedback.data} onSaved={saved} />
      ) : (
        <p className={s.subtitle}>Đang tải bảng hỏi…</p>
      )}
    </Shell>
  );
}

function SurveyForm({
  userId,
  state,
  onSaved,
}: {
  userId: string;
  state: FeedbackState;
  onSaved: (response: FeedbackResponseView) => void;
}) {
  const role = state.role;
  const key = draftKey(INSTRUMENT_VERSION, userId);
  const [initial] = useState(() => initialAnswers(role, state.response, readDraft(key)));
  const [answers, setAnswers] = useState<Answers>(initial.answers);
  const [errors, setErrors] = useState<Record<string, AnswerErrorReason>>({});
  const [dirty, setDirty] = useState(false);
  const [done, setDone] = useState(false);
  const [stale, setStale] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => writeDraft(key, answers), 600);
    return () => window.clearTimeout(timer);
  }, [answers, dirty, key]);

  const setAnswer = (code: string, value: number | string | undefined) => {
    setDirty(true);
    setDone(false);
    setAnswers((current) => {
      const next = { ...current };
      if (value === undefined) delete next[code];
      else next[code] = value;
      return next;
    });
    setErrors((current) => {
      if (!(code in current)) return current;
      const next = { ...current };
      delete next[code];
      return next;
    });
  };

  const showErrors = (list: readonly AnswerError[]) => {
    setErrors(Object.fromEntries(list.map((item) => [item.code, item.reason])));
    const first = firstErrorCode(role, list);
    if (!first) return;
    const target = document.getElementById(`q-${first}`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    target?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setDone(false);
    setStale(false);
    const checked = validateAnswers(role, answers);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    const result = await run((token) => saveFeedback(token, INSTRUMENT_VERSION, checked.answers));
    if (!result) return; // network, 5xx or 429: useAction shows the message
    if (!result.ok) {
      if (result.error === "invalid_answers") showErrors(result.items);
      else setStale(true);
      return;
    }
    clearDraft(key);
    setDirty(false);
    setErrors({});
    setDone(true);
    onSaved(result.response);
  };

  const items = itemsFor(role);
  const { answered, total } = progress(role, answers);
  const errorCount = Object.keys(errors).length;

  return (
    <form className={f.form} onSubmit={submit} noValidate>
      <p className={s.subtitle}>
        Khoảng {SURVEY_MINUTES[role]} phút. Tên và email của bạn không xuất hiện trong dữ liệu phân tích. Bạn có thể
        sửa câu trả lời sau.
      </p>
      {state.response ? <p className={s.fieldHint}>Đã gửi lúc {stamp(state.response.updatedAt)}</p> : null}
      {initial.fromDraft ? <Notice>Đã khôi phục bản nháp chưa gửi trên máy này.</Notice> : null}

      <div className={f.progress} role="status" aria-live="polite">
        <span className={f.progressText}>
          {answered}/{total} câu
        </span>
        <span className={f.progressTrack}>
          <span className={f.progressFill} style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
        </span>
      </div>

      {sectionsFor(role).map((section, index) => (
        <section key={section.id} className={f.section} aria-labelledby={`sec-${section.id}`}>
          <h2 id={`sec-${section.id}`} className={f.sectionTitle}>
            <span className={f.sectionNo}>{index + 1}</span>
            {sectionTitle(section, role)}
          </h2>
          {items
            .filter((item) => item.section === section.id)
            .map((item) => {
              const reason = errors[item.code];
              return (
                <SurveyItemField
                  key={item.code}
                  item={item}
                  role={role}
                  value={answers[item.code]}
                  error={reason ? errorText(reason) : null}
                  disabled={busy}
                  onChange={(value) => setAnswer(item.code, value)}
                />
              );
            })}
        </section>
      ))}

      <div className={f.submitBar}>
        <button type="submit" className={s.press} disabled={busy}>
          {busy ? "Đang lưu…" : state.response ? "Cập nhật câu trả lời" : "Gửi khảo sát"}
        </button>
        {errorCount > 0 ? <span className={f.missing}>{errorCount} câu cần xem lại</span> : null}
      </div>
      {done ? <Notice tone="ok">Cảm ơn bạn! Câu trả lời đã được lưu.</Notice> : null}
      {stale ? <Notice tone="alert">Bảng hỏi vừa được cập nhật. Tải lại trang để tiếp tục.</Notice> : null}
      {error ? <Notice tone="alert">{error}</Notice> : null}
    </form>
  );
}
