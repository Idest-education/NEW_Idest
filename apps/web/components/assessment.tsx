"use client";

import { useEffect, useState } from "react";
import { CRITERIA, criterionName, type Feedback, type Scores, type TaskType } from "../lib/api";
import { band, bandTone, bandWord } from "../lib/format";
import { useReducedMotion } from "../lib/motion";
import styles from "./assessment.module.css";

/**
 * The scored result, top to bottom: overall band and the one-paragraph verdict, one card per criterion
 * (band, comment, the evidence behind it). Sentence fixes live on the essay itself (EssayText).
 */
export function Assessment({
  scores,
  feedback,
  by,
  taskType,
}: {
  scores: Scores;
  feedback: Feedback;
  by: "ai" | "teacher";
  taskType: TaskType;
}) {
  const comment = feedback.comment ?? feedback.summary;
  const shown = useCountUp(scores.overall);
  const tone = bandTone(scores.overall);

  return (
    <div className={styles.wrap}>
      <div className={styles.top}>
        <div className={styles.overall}>
          <span className={`${styles.band} num tone-${tone}`} aria-hidden="true">
            {band(shown)}
            {tone === "great" && <span className={styles.sparkle}>✦</span>}
          </span>
          <span className="sr-only">{band(scores.overall)}</span>
          <span className={styles.overallLabel}>Overall band · {bandWord(scores.overall)}</span>
        </div>
        <span className={`chip ${by === "teacher" ? "chip-ok" : "chip-accent"}`}>
          {by === "teacher" ? "Finalized by a teacher" : "AI assessment"}
        </span>
      </div>

      {comment && <p className={styles.summary}>{comment}</p>}

      <ul className={styles.criteria} aria-label="Criteria">
        {CRITERIA.map((c, i) => {
          const { name, short } = criterionName(c, taskType);
          const note = feedback.criteria?.[c.key];
          const tone = bandTone(scores[c.key]);
          return (
            <li key={c.key} className={styles.criterion} style={{ animationDelay: `${0.15 + i * 0.08}s` }}>
              <div className={styles.criterionHead}>
                <span className={`${styles.criterionBand} num tone-${tone} tile-${tone}`}>{band(scores[c.key])}</span>
                <span className={styles.criterionTitle}>
                  <abbr title={name} className={styles.criterionShort}>
                    {short}
                  </abbr>
                  <span className={styles.criterionName}>{name}</span>
                </span>
              </div>
              {note?.comment && <p className={styles.criterionComment}>{note.comment}</p>}
              {(note?.reasoning || !!note?.evidence?.length) && (
                <details className={styles.why}>
                  <summary>Why this band</summary>
                  {note.evidence?.map((q, j) => (
                    <blockquote key={j} className={styles.quote}>
                      {q}
                    </blockquote>
                  ))}
                  {note.reasoning && <p className="hint">{note.reasoning}</p>}
                </details>
              )}
            </li>
          );
        })}
      </ul>

      {(!!feedback.strengths?.length || !!feedback.improvements?.length) && (
        <div className={styles.lists}>
          {!!feedback.strengths?.length && (
            <section>
              <h3 className={styles.h3}>What works</h3>
              <ul className={styles.bullets}>
                {feedback.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          )}
          {!!feedback.improvements?.length && (
            <section>
              <h3 className={styles.h3}>To reach the next band</h3>
              <ul className={styles.bullets}>
                {feedback.improvements.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

    </div>
  );
}

/** Counts the band up from 0 once, easing out, so the score lands like a reveal. */
function useCountUp(target: number) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState<number | null>(null);
  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 900);
      setValue(k < 1 ? Math.round((1 - (1 - k) ** 3) * target * 2) / 2 : target);
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, reduce]);
  return reduce || value === null ? target : value;
}
