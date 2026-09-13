"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BAY_LABEL,
  CRITERIA,
  CRITERION_LABEL,
  type Criterion,
  type Feedback,
  type Scores,
  type ScoringResult,
  type SubmissionFull,
  TASK_TYPE_LABEL,
  cancelRedoRequest,
  createRedoRequest,
  createRevision,
  publishResult,
  unpublishResult,
} from "../lib/idest";
import {
  band,
  deviation,
  isBand,
  overallFromCriteria,
  signedBand,
  splitParagraphs,
  stamp,
  stripRef,
} from "../lib/format";
import { useAction } from "../lib/use-api";
import { CriterionRow, Notice, board as s } from "./board";

export function Sheet({
  submission,
  onChanged,
}: {
  submission: SubmissionFull;
  onChanged: () => Promise<void>;
}) {
  const aiResult: ScoringResult | undefined = useMemo(
    () =>
      submission.scoringResults.find((r) => r.scorerType === "ai" && r.status === "completed") ??
      submission.scoringResults[0],
    [submission.scoringResults],
  );
  const latestRevision = submission.scoreRevisions[0];
  const activePublished = submission.publishedResults.find((p) => p.unpublishedAt === null);

  const machineScores = aiResult?.scores ?? {};
  const startScores: Scores = latestRevision?.finalScores ?? machineScores;
  const startFeedback: Feedback = latestRevision?.finalFeedback ?? {};

  const [scores, setScores] = useState<Scores>(startScores);
  const [summary, setSummary] = useState<string>(startFeedback.summary ?? "");
  const aiSummary = aiResult?.feedback?.summary ?? "";
  const [note, setNote] = useState("");
  // Nothing the machine wrote reaches the student unless the teacher takes it.
  const [adopted, setAdopted] = useState<number[]>([]);
  const [dirty, setDirty] = useState(false);
  const { busy, error: actionError, run } = useAction();

  useEffect(() => {
    setScores(startScores);
    setSummary(startFeedback.summary ?? "");
    setAdopted(
      latestRevision?.finalFeedback?.improvements?.length
        ? (aiResult?.feedback?.improvements ?? []).flatMap((item, index) =>
            latestRevision.finalFeedback.improvements?.includes(item) ? [index] : [],
          )
        : [],
    );
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission.id, latestRevision?.id, aiResult?.id]);

  const overall = useMemo(() => {
    const computed = overallFromCriteria(scores);
    return computed ?? scores.overall;
  }, [scores]);

  const paragraphs = useMemo(() => splitParagraphs(submission.essayText), [submission.essayText]);
  const marks = aiResult?.feedback?.sentence_feedback ?? [];

  // A teacher may grade before the AI has scored the essay, or because the AI
  // is unavailable or failed. Only a signed, published result is final.
  const canRevise = submission.status !== "published";
  const outOfBand = CRITERIA.filter((c) => scores[c] !== undefined && !isBand(scores[c]));
  const complete =
    CRITERIA.every((c) => isBand(scores[c])) && isBand(overall) && outOfBand.length === 0;

  const setCriterion = useCallback((criterion: Criterion, value: number | undefined) => {
    setScores((prev) => ({ ...prev, [criterion]: value }));
    setDirty(true);
  }, []);

  const aiImprovements = aiResult?.feedback?.improvements ?? [];
  const adoptedImprovements = adopted
    .slice()
    .sort((a, b) => a - b)
    .flatMap((index) => (aiImprovements[index] ? [aiImprovements[index]] : []));

  const saveRevision = useCallback(async () => {
    const payloadScores: Scores = { ...scores, overall };
    const saved = await run((token) =>
      createRevision(token, submission.id, {
        baseResultId: aiResult?.id,
        finalScores: payloadScores,
        finalFeedback: {
          summary: summary.trim() || undefined,
          improvements: adoptedImprovements,
        },
        revisionNote: note.trim() || undefined,
      }),
    );
    if (saved) {
      setDirty(false);
      setNote("");
      await onChanged();
    }
    return saved;
  }, [aiResult, scores, overall, summary, note, run, submission.id, adoptedImprovements, onChanged]);

  const sign = useCallback(async () => {
    const revision = dirty || !latestRevision ? await saveRevision() : latestRevision;
    if (!revision) return;
    const published = await run((token) => publishResult(token, submission.id, revision.id));
    if (published) await onChanged();
  }, [dirty, latestRevision, saveRevision, run, submission.id, onChanged]);

  const withdraw = useCallback(async () => {
    const done = await run((token) =>
      unpublishResult(token, submission.id, "Giáo viên gỡ để sửa lại điểm"),
    );
    if (done) await onChanged();
  }, [run, submission.id, onChanged]);

  const [redoOpen, setRedoOpen] = useState(false);
  const [redoReason, setRedoReason] = useState("");
  const { busy: redoBusy, error: redoError, run: runRedo } = useAction();

  const sendRedo = useCallback(async () => {
    if (!redoReason.trim()) return;
    const done = await runRedo((token) => createRedoRequest(token, submission.id, redoReason.trim()));
    if (done) {
      setRedoReason("");
      setRedoOpen(false);
      await onChanged();
    }
  }, [redoReason, runRedo, submission.id, onChanged]);

  const cancelRedo = useCallback(async () => {
    if (!submission.openRedoRequest) return;
    const done = await runRedo((token) =>
      cancelRedoRequest(token, submission.id, submission.openRedoRequest!.id),
    );
    if (done) await onChanged();
  }, [runRedo, submission.id, submission.openRedoRequest, onChanged]);

  return (
    <>
      <div className={s.slugLine}>
        <span className={s.slugRef}>{stripRef(submission.id, submission.attemptNumber)}</span>
        <h1 className={s.title} style={{ marginRight: "auto" }}>
          {submission.student?.displayName ?? "Học viên"}
        </h1>
        <span className={s.slugMeta}>
          <span>{submission.wordCount} từ</span>
          <span>nộp {stamp(submission.submittedAt)}</span>
          <span>
            {TASK_TYPE_LABEL[submission.assignment.taskType]} · {submission.assignment.title}
          </span>
          <span>{BAY_LABEL[submission.status]}</span>
        </span>
      </div>

      <div className={s.sheet}>
        <div>
          <p className={s.prompt}>{submission.assignment.taskPrompt}</p>

          <article className={s.essaySheet}>
            <div className={s.essay}>
              {paragraphs.map((paragraph, index) => (
                <div key={index} className={s.essayPara}>
                  <span className={s.essayNum}>{String(index + 1).padStart(2, "0")}</span>
                  <p>{paragraph}</p>
                </div>
              ))}
            </div>
          </article>

          {marks.length > 0 ? (
            <>
              <div className={s.sectionHead}>
                <h2 className={s.sectionTitle}>AI đánh dấu theo câu</h2>
                <span className={s.label}>{marks.length} dấu</span>
              </div>
              <div className={s.rack}>
                {marks.map((mark, index) => (
                  <div key={index} className={s.mark}>
                    <span className={s.markRef}>
                      CÂU {mark.sentence_index + 1} · {mark.category.toUpperCase()}
                    </span>
                    <span>
                      <span className={s.markOriginal}>{mark.original}</span>
                      <span className={s.markSuggestion}>{mark.suggestion}</span>
                      <span className={s.markWhy}>{mark.explanation}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <aside className={s.rail}>
          <>
              {!aiResult ? (
                <Notice>
                  Chưa có bản chấm của AI — bài đang chờ máy, hoặc máy chấm không khả dụng. Bạn có
                  thể chấm trực tiếp; kết quả vẫn duyệt được bình thường.
                </Notice>
              ) : null}

              <section className={s.railBlock}>
                <header className={s.railHead}>
                  <span className={s.label}>Điểm tổng</span>
                  <span className={s.label}>
                    {aiResult
                      ? aiResult.modelVersion
                        ? `${aiResult.modelVersion.modelName} · ${aiResult.modelVersion.modelVersion}`
                        : "AI"
                      : "Giáo viên chấm trực tiếp"}
                  </span>
                </header>
                <div className={s.overall}>
                  <span
                    className={`${s.overallFigure} ${!latestRevision && !dirty ? s.overallFigureMachine : ""}`}
                  >
                    {band(overall)}
                  </span>
                  <span className={s.overallSide}>
                    <span className={s.overallCaption}>
                      {latestRevision || dirty ? "Giáo viên quyết định" : "AI chấm sơ bộ"}
                    </span>
                    {aiResult && (latestRevision || dirty) ? (
                      <span className={s.struck}>AI {band(machineScores.overall)}</span>
                    ) : null}
                    {aiResult && deviation(machineScores.overall, overall) !== null ? (
                      <span className={s.deviation}>
                        lệch {signedBand(deviation(machineScores.overall, overall))} so với AI
                      </span>
                    ) : null}
                  </span>
                </div>
              </section>

              <section className={s.railBlock}>
                <header className={s.railHead}>
                  <span className={s.label}>Bốn tiêu chí</span>
                  <span className={s.label}>AI · bạn · lệch</span>
                </header>
                {CRITERIA.map((criterion) => (
                  <CriterionRow
                    key={criterion}
                    criterion={criterion}
                    name={CRITERION_LABEL[criterion]}
                    machine={machineScores[criterion]}
                    value={scores[criterion]}
                    editable={canRevise}
                    onChange={(next) => setCriterion(criterion, next)}
                  />
                ))}
                {outOfBand.length > 0 ? (
                  <Notice tone="alert">
                    {outOfBand.map((c) => CRITERION_LABEL[c]).join(", ")}: điểm phải nằm trong 0–9
                    và theo bước 0.5.
                  </Notice>
                ) : !complete && canRevise ? (
                  <p className={s.fieldHint}>
                    Cần đủ bốn tiêu chí (0–9, bước 0.5) thì mới duyệt được.
                  </p>
                ) : null}
              </section>

              <section className={s.railBlock}>
                <header className={s.railHead}>
                  <span className={s.label}>Nhận xét</span>
                </header>
                {aiSummary ? (
                  <>
                    <p className={s.machineNote}>AI viết: {aiSummary}</p>
                    {canRevise ? (
                      <div className={s.actionRow} style={{ marginTop: "0.5rem" }}>
                        <button
                          type="button"
                          className={s.pressQuiet}
                          onClick={() => {
                            setSummary(aiSummary);
                            setDirty(true);
                          }}
                        >
                          Chép bản của AI xuống để sửa
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <div className={s.fieldRow}>
                  <label className={s.fieldLabel} htmlFor="summary">
                    Nhận xét gửi học viên — bạn viết, không lấy sẵn của máy
                  </label>
                  <textarea
                    id="summary"
                    className={s.field}
                    rows={7}
                    value={summary}
                    disabled={!canRevise}
                    placeholder={
                      aiSummary
                        ? "Viết nhận xét của bạn. Bản của AI ở trên chỉ để tham khảo."
                        : "Viết nhận xét của bạn."
                    }
                    onChange={(e) => {
                      setSummary(e.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
              </section>

              {canRevise ? (
                <section className={s.commit}>
                  <p className={s.commitHead}>
                    {activePublished ? "Duyệt lại — học viên sẽ thấy bản mới" : "Trước khi duyệt"}
                  </p>
                  {aiImprovements.length ? (
                    <div className={s.commitAdopt}>
                      <span className={s.label}>AI gợi ý sửa — tick để gửi cho học viên</span>
                      {aiImprovements.map((item, index) => (
                        <label
                          key={index}
                          className={`${s.adopt} ${adopted.includes(index) ? s.adoptTaken : ""}`}
                        >
                          <input
                            type="checkbox"
                            className={s.adoptBox}
                            checked={adopted.includes(index)}
                            disabled={!canRevise}
                            onChange={(event) => {
                              setAdopted((prev) =>
                                event.target.checked
                                  ? [...prev, index]
                                  : prev.filter((i) => i !== index),
                              );
                              setDirty(true);
                            }}
                          />
                          <span>{item}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <div className={s.commitPreview}>
                    <span className={s.label}>Học viên sẽ đọc đúng bản này</span>
                    {complete ? (
                      <>
                        <p>
                          <span className={s.commitPreviewFigure}>{band(overall)}</span>{" "}
                          {CRITERIA.map((c) => `${band(scores[c])}`).join(" · ")}
                        </p>
                        <p>{summary.trim() || "— chưa có nhận xét —"}</p>
                        {adoptedImprovements.length ? (
                          <div className={s.noteList}>
                            <span className={s.label}>Nên sửa</span>
                            {adoptedImprovements.map((item, index) => (
                              <span key={index} className={s.noteItem}>
                                <span className={s.noteBullet}>
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <span>{item}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className={s.fieldHint}>Không gửi gợi ý nào ngoài nhận xét trên.</p>
                        )}
                      </>
                    ) : (
                      <p className={s.fieldHint}>
                        Chưa xem được bản gửi học viên: bốn tiêu chí phải là điểm IELTS hợp lệ
                        (0–9, bước 0.5).
                      </p>
                    )}
                  </div>
                  <div className={s.fieldRow}>
                    <label className={s.fieldLabel} htmlFor="note">
                      Ghi chú nội bộ (học viên không thấy)
                    </label>
                    <input
                      id="note"
                      className={s.field}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Nâng LR vì đoạn 2 dùng từ chính xác hơn"
                    />
                  </div>
                  <div className={s.actionRow}>
                    <button
                      type="button"
                      className={s.pressQuiet}
                      disabled={busy || !dirty || !complete}
                      onClick={saveRevision}
                    >
                      {busy ? "Đang lưu…" : "Lưu bản sửa"}
                    </button>
                    <button
                      type="button"
                      className={s.press}
                      disabled={busy || !complete}
                      onClick={sign}
                    >
                      {busy ? "Đang duyệt…" : "Duyệt điểm"}
                    </button>
                  </div>
                  {actionError ? <Notice tone="alert">{actionError}</Notice> : null}
                </section>
              ) : null}

              {submission.status === "published" && activePublished ? (
                <section className={s.railBlock}>
                  <span className={s.stamp}>Đã duyệt · {stamp(activePublished.publishedAt)}</span>
                  <p className={s.fieldHint} style={{ marginTop: "0.6rem" }}>
                    Học viên đang đọc bản này. Mở lại nếu bạn cần sửa lại điểm.
                  </p>
                  <div className={s.actionRow}>
                    <button type="button" className={s.pressQuiet} disabled={busy} onClick={withdraw}>
                      {busy ? "Đang mở…" : "Mở lại để sửa"}
                    </button>
                  </div>
                  {actionError ? <Notice tone="alert">{actionError}</Notice> : null}
                </section>
              ) : null}

              {submission.status === "failed" ? (
                <Notice tone="alert">
                  Máy chấm lỗi ở lần này. Bài viết vẫn còn nguyên vẹn — bạn có thể chấm trực tiếp
                  bên trên, không cần học viên nộp lại.
                </Notice>
              ) : null}

              {submission.status !== "published" ? (
                <section className={s.railBlock}>
                  <header className={s.railHead}>
                    <span className={s.label}>Yêu cầu làm lại</span>
                  </header>
                  {submission.openRedoRequest ? (
                    <>
                      <p className={s.machineNote}>
                        Đã yêu cầu · {stamp(submission.openRedoRequest.createdAt)}
                      </p>
                      <p style={{ marginTop: "0.4rem" }}>{submission.openRedoRequest.reason}</p>
                      <div className={s.actionRow}>
                        <button
                          type="button"
                          className={s.pressQuiet}
                          disabled={redoBusy}
                          onClick={cancelRedo}
                        >
                          {redoBusy ? "Đang hủy…" : "Hủy yêu cầu"}
                        </button>
                      </div>
                    </>
                  ) : redoOpen ? (
                    <>
                      <div className={s.fieldRow}>
                        <label className={s.fieldLabel} htmlFor="redo-reason">
                          Lý do — học viên sẽ đọc dòng này
                        </label>
                        <textarea
                          id="redo-reason"
                          className={s.field}
                          rows={2}
                          value={redoReason}
                          onChange={(e) => setRedoReason(e.target.value)}
                          placeholder="Bài chưa đúng dạng Task 2, em viết lại theo đề nhé."
                        />
                      </div>
                      <div className={s.actionRow}>
                        <button
                          type="button"
                          className={s.press}
                          disabled={redoBusy || !redoReason.trim()}
                          onClick={sendRedo}
                        >
                          {redoBusy ? "Đang gửi…" : "Gửi yêu cầu"}
                        </button>
                        <button type="button" className={s.pressQuiet} onClick={() => setRedoOpen(false)}>
                          Thôi
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className={s.actionRow}>
                      <button type="button" className={s.pressQuiet} onClick={() => setRedoOpen(true)}>
                        Yêu cầu học viên làm lại
                      </button>
                    </div>
                  )}
                  {redoError ? <Notice tone="alert">{redoError}</Notice> : null}
                </section>
              ) : null}
          </>

          <History submission={submission} />
        </aside>
      </div>
    </>
  );
}

function History({ submission }: { submission: SubmissionFull }) {
  const entries = useMemo(() => {
    const ai = submission.scoringResults.map((r) => ({
      key: `ai-${r.id}`,
      kind: "ai" as const,
      title: r.status === "failed" ? "AI chấm lỗi" : "AI chấm sơ bộ",
      at: r.createdAt,
      detail: r.status === "failed" ? "Không có điểm" : `Điểm tổng ${band(r.scores.overall)}`,
    }));
    const revisions = submission.scoreRevisions.map((r) => ({
      key: `rev-${r.id}`,
      kind: "teacher" as const,
      title: `Giáo viên sửa · bản ${r.revisionNumber}`,
      at: r.createdAt,
      detail: `Điểm tổng ${band(r.finalScores.overall)}${
        r.revisionNote ? ` · ${r.revisionNote}` : ""
      }`,
    }));
    const published = submission.publishedResults.map((p) => ({
      key: `pub-${p.id}`,
      kind: "signed" as const,
      title: p.unpublishedAt ? "Đã hủy duyệt" : "Đã duyệt",
      at: p.publishedAt,
      detail: `Điểm tổng ${band(p.finalScores.overall)}`,
    }));
    return [...ai, ...revisions, ...published].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  }, [submission]);

  if (entries.length === 0) return null;

  return (
    <section className={s.railBlock}>
      <header className={s.railHead}>
        <span className={s.label}>Lịch sử chấm điểm</span>
        <span className={s.label}>không ghi đè</span>
      </header>
      <div className={s.timeline}>
        {entries.map((entry) => (
          <div key={entry.key} className={s.timelineItem}>
            <span
              className={`${s.timelineTick} ${
                entry.kind === "teacher"
                  ? s.timelineTickTeacher
                  : entry.kind === "signed"
                    ? s.timelineTickSigned
                    : ""
              }`}
            />
            <div className={s.timelineBody}>
              <p className={s.timelineTitle}>{entry.title}</p>
              <p className={s.timelineMeta}>
                {stamp(entry.at)} · {entry.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
