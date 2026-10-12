"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import {
  ABUSE_COPY,
  CRITERIA,
  criterionName,
  describeError,
  type CriterionKey,
  type Feedback,
  type RevisionInput,
  type ScoreRevision,
  type ScoringResult,
  type SentenceFeedback,
  type Submission,
} from "../lib/api";
import { band, bandTone, dateTime, isWorking, overallFrom, STATUS_LABEL, taskLabel, withOverall } from "../lib/format";
import { useApi, useLoad } from "../lib/use-api";
import { EssayText } from "./essay-text";
import { Icon } from "./icon";
import { Notice } from "./session";
import { useToast } from "./toast";
import styles from "./review.module.css";

const TIMELINE: Record<string, string> = {
  ai_scoring: "AI scored",
  teacher_revision: "Draft saved",
  published_active: "Finalized",
  published_superseded: "Finalized, then reopened",
};

const DONE_COPY: Record<string, string> = {
  save: "Draft saved.",
  publish: "Finalized. The score is now final.",
  reopen: "Reopened. Edit away.",
  retry: "Sent back to Io for grading.",
  abuse: "Got it. Decision saved.",
};

export function Review({ id }: { id: string }) {
  const api = useApi();
  const submission = useLoad(`sub:${id}`, () => api.submission(id), (s) => isWorking(s.status));
  const history = useLoad(`hist:${id}:${submission.data?.status}:${submission.data?.scoreRevisions.length}`, () =>
    api.history(id),
  );
  const toast = useToast();
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openSession = useEffectEvent(() => {
    api.reviewSession(id).catch(() => {});
  });
  useEffect(() => {
    openSession();
  }, [id]);

  if (submission.error && !submission.data) {
    return (
      <Notice io="lost" title="We couldn't open this essay" body={submission.error}>
        <button className="btn btn-secondary" onClick={submission.reload}>
          Try again
        </button>
      </Notice>
    );
  }
  const s = submission.data;
  if (!s) {
    return (
      <div className={styles.panes} aria-busy="true">
        <div className="skeleton" style={{ height: 420 }} />
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    );
  }

  const ai = s.scoringResults.find((r) => r.scorerType === "ai" && r.status === "completed");
  const latest = s.scoreRevisions[0];
  const active = s.publishedResults[0];
  const finalized = s.status === "published" && Boolean(active);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setAction(label);
    setError(null);
    try {
      await fn();
      toast(DONE_COPY[label] ?? "Done.");
      submission.reload();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setAction(null);
    }
  };

  const header = (
    <>
      <div className={styles.crumbs}>
        <Link href={s.batchId ? `/batches/${s.batchId}` : "/history"} className="hint">
          ← {s.batchId ? "Batch" : "History"}
        </Link>
      </div>
      <div className="row">
        <h1 className={styles.title}>{s.sourceRef?.studentLabel || "Essay"}</h1>
        <span className="chip">{taskLabel(s.taskType)}</span>
        <span className="chip num">{s.wordCount} words</span>
        <span className={`chip ${finalized ? "chip-ok" : s.status === "failed" ? "chip-danger" : ""}`}>
          {STATUS_LABEL[s.status]}
        </span>
      </div>
      <p className={styles.prompt}>{s.taskPrompt}</p>
      {s.taskImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- remote chart from the API host
        <img src={s.taskImageUrl} alt="Task 1 chart" className={styles.chart} />
      )}
      {s.status === "abuse" && (
        <div className="alert alert-mark" role="alert" style={{ display: "grid" }}>
          <strong>
            <Icon name="flag" /> This essay was held back before grading.
          </strong>
          <span>
            {(s.abuseReason ?? "")
              .split(",")
              .map((r) => ABUSE_COPY[r])
              .filter(Boolean)
              .join(" ") || "It looks unusual."}{" "}
            Decide what to do with it.
          </span>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              disabled={action !== null}
              onClick={() => run("abuse", () => api.abuseReview(id, "reject", "requeue"))}
            >
              It&apos;s fine, grade it
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={action !== null}
              onClick={() => run("abuse", () => api.abuseReview(id, "reject", "manual"))}
            >
              I&apos;ll grade it myself
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={action !== null}
              onClick={() => run("abuse", () => api.abuseReview(id, "confirm"))}
            >
              Keep it flagged
            </button>
          </div>
        </div>
      )}
    </>
  );

  const footer = (
    <details className={styles.history}>
      <summary>History</summary>
      {history.data ? (
        <ol>
          {history.data.timeline.map((t, i) => (
            <li key={i}>
              <span>{TIMELINE[t.type] ?? t.type}</span> <span className="hint">{dateTime(t.timestamp)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint">{history.error ?? "Loading…"}</p>
      )}
    </details>
  );

  const alerts = (
    <>
      <div aria-live="polite" role="status">
        {isWorking(s.status) && (
          <p className="alert">
            <Icon name="hourglass_top" /> AI is grading this essay. You can start your own scores now.
          </p>
        )}
      </div>
      {s.status === "failed" && (
        <div className="alert alert-danger" role="alert" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Icon name="error" />
          <span style={{ flex: 1 }}>AI grading failed. Try again, or grade it yourself.</span>
          <button
            className="btn btn-secondary btn-sm"
            disabled={action !== null}
            onClick={() => run("retry", () => api.retryScoring(id))}
          >
            <Icon name="refresh" /> Retry AI grading
          </button>
        </div>
      )}
      {error && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {error}
        </p>
      )}
    </>
  );

  return (
    <Workspace
      key={`${latest?.id ?? "none"}:${ai?.id ?? "none"}:${finalized}`}
      submission={s}
      ai={ai}
      latest={latest}
      finalized={finalized}
      busy={action}
      header={header}
      footer={footer}
      alerts={alerts}
      publishedAt={finalized ? active?.publishedAt : undefined}
      onReopen={() => run("reopen", () => api.unpublish(id))}
      onSave={(input, publish) =>
        run(publish ? "publish" : "save", async () => {
          const rev = input ? await api.saveRevision(id, input) : latest!;
          if (publish) await api.publish(id, rev.id);
        })
      }
    />
  );
}

type Draft = Record<CriterionKey, number | null>;
type Notes = Record<CriterionKey, string>;

/** The overall comment to start from; older results split it into three parts. */
function commentOf(f?: Feedback): string {
  if (!f) return "";
  if (f.comment !== undefined) return f.comment;
  return [
    f.summary,
    f.strengths?.length ? `What works: ${f.strengths.join("; ")}` : "",
    f.improvements?.length ? `To reach the next band: ${f.improvements.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const notesOf = (f?: Feedback): Notes =>
  Object.fromEntries(CRITERIA.map((c) => [c.key, f?.criteria?.[c.key]?.comment ?? ""])) as Notes;

/** Both panes: the essay with its sentence comments, and the scoring form. Remounts on every saved revision. */
function Workspace({
  submission,
  ai,
  latest,
  finalized,
  busy,
  header,
  footer,
  alerts,
  publishedAt,
  onSave,
  onReopen,
}: {
  submission: Submission;
  ai?: ScoringResult;
  latest?: ScoreRevision;
  finalized: boolean;
  busy: string | null;
  header: ReactNode;
  footer: ReactNode;
  alerts: ReactNode;
  publishedAt?: string;
  onSave: (input: RevisionInput | null, publish: boolean) => void;
  onReopen: () => void;
}) {
  const start = latest ? { scores: latest.finalScores, feedback: latest.finalFeedback } : ai;
  const initial: Draft = Object.fromEntries(CRITERIA.map((c) => [c.key, start?.scores[c.key] ?? null])) as Draft;
  const [scores, setScores] = useState<Draft>(initial);
  const [comment, setComment] = useState(commentOf(start?.feedback));
  const [notes, setNotes] = useState<Notes>(notesOf(start?.feedback));
  const [sentences, setSentences] = useState<SentenceFeedback[]>(start?.feedback.sentence_feedback ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  const banner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // After Finalize the button sits at the bottom; bring the confirmation into view.
    if (finalized) banner.current?.scrollIntoView({ block: "nearest" });
  }, [finalized]);

  function buildFeedback(comment: string, notes: Notes, sentences: SentenceFeedback[], scores: Draft): Feedback {
    return {
      comment: comment.trim(),
      criteria: Object.fromEntries(
        CRITERIA.map((c) => {
          const why = ai?.feedback.criteria?.[c.key];
          // The AI's reasoning backs the AI's band; drop it once the teacher picks another.
          const keep = why && scores[c.key] === ai?.scores[c.key];
          return [
            c.key,
            { comment: notes[c.key].trim(), ...(keep ? { evidence: why.evidence, reasoning: why.reasoning } : {}) },
          ];
        }),
      ),
      sentence_feedback: sentences,
    };
  }
  // What this form would save untouched; comparing to the server's copy breaks on key order.
  const [baseline] = useState(() =>
    JSON.stringify(
      buildFeedback(commentOf(start?.feedback), notesOf(start?.feedback), start?.feedback.sentence_feedback ?? [], initial),
    ),
  );

  const complete = CRITERIA.every((c) => scores[c.key] !== null);
  const overall = complete ? overallFrom(scores as Record<CriterionKey, number>) : null;
  // "Your band" only means something once the teacher has moved away from the AI's bands.
  const changed = !ai || CRITERIA.some((c) => scores[c.key] !== ai.scores[c.key]);
  const feedback = () => buildFeedback(comment, notes, sentences, scores);
  const dirty =
    !latest || CRITERIA.some((c) => scores[c.key] !== initial[c.key]) || JSON.stringify(feedback()) !== baseline;
  const unsaved = !finalized && Boolean(latest) && dirty;

  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const adoptAiBands = () => {
    if (!ai) return;
    setScores(Object.fromEntries(CRITERIA.map((c) => [c.key, ai.scores[c.key]])) as Draft);
  };
  const resetComments = () => {
    if (!ai) return;
    setComment(commentOf(ai.feedback));
    setNotes(notesOf(ai.feedback));
    setSentences(ai.feedback.sentence_feedback ?? []);
  };

  const submit = (publish: boolean) => {
    if (!complete) return setProblem("Give all four criteria a band first.");
    setProblem(null);
    onSave(
      dirty
        ? {
            baseResultId: ai?.id,
            finalScores: withOverall(scores as Record<CriterionKey, number>),
            finalFeedback: feedback(),
          }
        : null,
      publish,
    );
  };

  return (
    <div className={styles.panes}>
      <section className={styles.essayPane} aria-label="Essay">
        {header}
        <div className={styles.essay}>
          <EssayText
            text={submission.essayText}
            comments={sentences}
            taskType={submission.taskType}
            onChange={finalized ? undefined : setSentences}
          />
        </div>
        <p className="hint">
          {sentences.length > 0 ? `${sentences.length} sentence comment${sentences.length === 1 ? "" : "s"}. ` : ""}
          {finalized
            ? "Hover a highlight to read its comment."
            : "Hover a highlight to read it, click to edit, or select any text to add your own comment."}
        </p>
        {footer}
      </section>

      <section className={styles.formPane} aria-label="Assessment">
        {alerts}
        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
          <div className={styles.bandRow}>
            <div>
              <span className="hint">{finalized ? "AI band" : "AI"}</span>
              <p className={`${changed || finalized ? styles.aiBand : styles.mainBand} num`}>{band(ai?.scores.overall)}</p>
            </div>
            {(changed || finalized) && (
              <>
                <Icon name="arrow_upward" className={styles.arrow} />
                <div>
                  <span className="hint">{finalized ? "Final" : "Your band"}</span>
                  <p className={`${styles.mainBand} num`} aria-live="polite">
                    {band(overall)}
                  </p>
                </div>
              </>
            )}
            {ai && changed && !finalized && (
              <button type="button" className={styles.linkButton} style={{ marginLeft: "auto" }} onClick={adoptAiBands}>
                Use all AI bands
              </button>
            )}
          </div>

          {finalized && (
            <div ref={banner} className="alert alert-ok" style={{ alignItems: "center", flexWrap: "wrap" }}>
              <Icon name="check_circle" />
              <span style={{ flex: 1 }}>Finalized {publishedAt ? dateTime(publishedAt) : ""}. Reopen to make changes.</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onReopen} disabled={busy !== null}>
                {busy === "reopen" ? "Reopening" : "Reopen"}
              </button>
            </div>
          )}

          <fieldset className={styles.fieldset} disabled={finalized || busy !== null}>
            <legend className="sr-only">Scores and comments</legend>
            <div className={styles.criteria}>
              {CRITERIA.map((c) => {
                const { name, short } = criterionName(c, submission.taskType);
                const aiValue = ai?.scores[c.key];
                const aiNote = ai?.feedback.criteria?.[c.key];
                const differs = aiValue !== undefined && scores[c.key] !== aiValue;
                const whyId = `why-${c.key}`;
                return (
                  <div key={c.key} className={styles.criterion}>
                    <div className={styles.critHead}>
                      <span className={styles.critName}>
                        <span className={styles.critShort}>{short}</span>
                        <span>{name}</span>
                      </span>
                      <BandStepper
                        label={name}
                        value={scores[c.key]}
                        start={aiValue ?? 5}
                        onChange={(v) => setScores((s) => ({ ...s, [c.key]: v }))}
                      />
                    </div>
                    <div className={styles.critMeta}>
                      {aiValue !== undefined && (
                        <span className="hint num">
                          AI <strong>{band(aiValue)}</strong>
                        </span>
                      )}
                      {differs && (
                        <button
                          type="button"
                          className={styles.linkButton}
                          onClick={() => {
                            setScores((s) => ({ ...s, [c.key]: aiValue }));
                            if (aiNote) setNotes((n) => ({ ...n, [c.key]: aiNote.comment }));
                          }}
                        >
                          Use AI
                        </button>
                      )}
                      {(aiNote?.reasoning || !!aiNote?.evidence?.length) && (
                        <>
                          <button type="button" className={styles.linkButton} popoverTarget={whyId}>
                            Why?
                          </button>
                          <div id={whyId} popover="auto" className={styles.whyPop}>
                            <p className={styles.whyTitle}>
                              Why the AI gave {name} {band(aiValue)}
                            </p>
                            {aiNote.evidence?.map((q, i) => (
                              <blockquote key={i} className={styles.quote}>
                                {q}
                              </blockquote>
                            ))}
                            {aiNote.reasoning && <p className="hint">{aiNote.reasoning}</p>}
                          </div>
                        </>
                      )}
                    </div>
                    <label className="sr-only" htmlFor={`note-${c.key}`}>
                      Comment on {name}
                    </label>
                    <textarea
                      id={`note-${c.key}`}
                      className={`textarea ${styles.critNote}`}
                      rows={5}
                      placeholder={`What should the student know about ${name.toLowerCase()}?`}
                      value={notes[c.key]}
                      onChange={(e) => setNotes((n) => ({ ...n, [c.key]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>

            <section className={styles.section} aria-labelledby="fb-h">
              <div className={styles.sectionHead}>
                <label id="fb-h" htmlFor="fb-comment" className={styles.h2}>
                  Overall comment
                </label>
                {ai && (
                  <button type="button" className={styles.linkButton} onClick={resetComments}>
                    Reset all comments to the AI&apos;s
                  </button>
                )}
              </div>
              <textarea
                id="fb-comment"
                className={`textarea ${styles.grow}`}
                placeholder="The one paragraph the student reads first."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </section>
          </fieldset>

          {!finalized && (
            <div className={styles.actions}>
              {problem ? (
                <span className={styles.problem} role="alert">
                  <Icon name="error" /> {problem}
                </span>
              ) : (
                <span className="hint">
                  {unsaved
                    ? "Unsaved changes"
                    : latest
                      ? `Draft ${latest.revisionNumber} saved ${dateTime(latest.createdAt)}`
                      : "Not saved yet"}
                </span>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => submit(false)}
                disabled={busy !== null || !dirty}
              >
                {busy === "save" ? "Saving" : "Save draft"}
              </button>
              <button type="button" className="btn btn-primary" onClick={() => submit(true)} disabled={busy !== null}>
                <Icon name="check" /> {busy === "publish" ? "Finalizing" : "Finalize"}
              </button>
            </div>
          )}
          {submission.source === "public" && !finalized && (
            <p className="hint">Finalizing replaces the AI result on this essay&apos;s shared link.</p>
          )}
        </form>
      </section>
    </div>
  );
}

/** A band from 0 to 9 in half steps: − and + buttons, or arrow keys on the value. */
function BandStepper({
  label,
  value,
  start,
  onChange,
}: {
  label: string;
  value: number | null;
  start: number;
  onChange: (v: number) => void;
}) {
  const step = (d: number) => onChange(Math.min(9, Math.max(0, (value ?? start - d) + d)));
  const tone = value === null ? "" : `tone-${bandTone(value)}`;
  return (
    <div className={styles.stepper} role="group" aria-label={`${label} band`}>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={() => step(-0.5)}
        disabled={value === 0}
        aria-label={`Lower ${label}`}
      >
        −
      </button>
      <output
        className={`${styles.stepValue} num ${tone}`}
        tabIndex={0}
        aria-label={`${label}: ${value === null ? "no band" : band(value)}. Use arrow keys to change.`}
        onKeyDown={(e) => {
          if (e.currentTarget.closest("fieldset")?.disabled) return;
          if (e.key === "ArrowUp" || e.key === "ArrowRight") step(0.5);
          else if (e.key === "ArrowDown" || e.key === "ArrowLeft") step(-0.5);
          else return;
          e.preventDefault();
        }}
      >
        {band(value)}
      </output>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={() => step(0.5)}
        disabled={value === 9}
        aria-label={`Raise ${label}`}
      >
        +
      </button>
    </div>
  );
}
