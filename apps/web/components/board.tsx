"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  BAY_LABEL,
  CRITERIA,
  CRITERION_ABBR,
  type Criterion,
  type Scores,
  type SubmissionStatus,
} from "../lib/idest";
import { band, deviation, isBand, signedBand, stripRef } from "../lib/format";
import { Masthead } from "./masthead";
import styles from "./board.module.css";
import type { Role } from "@repo/auth-contract";

export { styles as board };

export function Shell({
  role,
  wide,
  children,
}: {
  role?: Role;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <Masthead role={role} />
      <main className={`${styles.main} ${wide ? styles.wide : ""}`}>{children}</main>
    </div>
  );
}

/** Physical treatment per bay — colour is never the only signal. */
const STRIP_STATE_CLASS: Record<SubmissionStatus, string | undefined> = {
  submitted: styles.stripWaiting,
  queued: styles.stripWaiting,
  scoring: styles.stripWaiting,
  scored: styles.stripScored,
  under_review: styles.stripReview,
  published: styles.stripSigned,
  failed: styles.stripFailed,
};

export function Strip({
  href,
  submissionId,
  attempt,
  title,
  meta,
  status,
  statusLabel,
  scores,
  machinePrinted = true,
  showCriteria = true,
  treatment,
}: {
  href?: string;
  submissionId: string;
  attempt: number;
  title: string;
  meta: string[];
  status: SubmissionStatus;
  statusLabel?: string;
  scores?: Scores;
  machinePrinted?: boolean;
  showCriteria?: boolean;
  /**
   * Physical treatment to seat the strip in, when it must differ from the real
   * status. Student surfaces pass the waiting treatment for `failed`: the alert
   * hatch is teacher-side material and would tell a student their work broke.
   */
  treatment?: SubmissionStatus;
}) {
  const seated = treatment ?? status;
  const stateClass =
    seated === "published"
      ? styles.stripStateSigned
      : seated === "failed"
        ? styles.stripStateFailed
        : "";

  const body = (
    <>
      <span className={styles.stripRef}>{stripRef(submissionId, attempt)}</span>
      <span className={styles.stripBody}>
        <span className={styles.stripName}>{title}</span>
        <span className={styles.stripMeta}>
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </span>
      </span>
      <span className={styles.stripEnd}>
        {showCriteria && scores ? (
          <span className={styles.stripBands}>
            {CRITERIA.map((criterion) => (
              <span key={criterion} className={styles.stripBand}>
                <span className={styles.stripBandLabel}>{CRITERION_ABBR[criterion]}</span>
                <span className={styles.stripBandValue}>{band(scores[criterion])}</span>
              </span>
            ))}
          </span>
        ) : null}
        {scores ? (
          <span
            className={`${styles.stripOverall} ${machinePrinted ? styles.stripOverallMachine : ""}`}
          >
            {band(scores.overall)}
          </span>
        ) : null}
        <span className={`${styles.stripState} ${stateClass}`}>
          {statusLabel ?? BAY_LABEL[status]}
        </span>
      </span>
    </>
  );

  const className = `${styles.strip} ${STRIP_STATE_CLASS[seated]}`;

  if (!href) return <div className={className}>{body}</div>;

  return (
    <Link href={href} className={className}>
      {body}
    </Link>
  );
}

export function CriterionRow({
  criterion,
  name,
  machine,
  value,
  editable,
  onChange,
}: {
  criterion: Criterion;
  name: string;
  machine: number | undefined;
  value: number | undefined;
  editable?: boolean;
  onChange?: (next: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = value !== undefined && !isBand(value);
  const diff = deviation(machine, value);
  const diffClass =
    diff === null || diff === 0 ? "" : diff > 0 ? styles.deviationUp : styles.deviationDown;
  // On a signed sheet there is no machine print to show, so the row loses the
  // AI and deviation columns rather than printing empty ones.
  const printed = typeof machine === "number";

  return (
    <div className={`${styles.criterion} ${printed ? "" : styles.criterionSigned}`}>
      <span className={styles.criterionName}>
        {name}
        <span className={styles.criterionAbbr}>{CRITERION_ABBR[criterion]}</span>
      </span>
      {printed ? (
        <span
          className={`${styles.criterionMachine} ${
            diff !== null && diff !== 0 ? styles.criterionMachineStruck : ""
          }`}
          aria-label={`AI chấm ${band(machine)}${diff !== null && diff !== 0 ? ", đã bị giáo viên sửa" : ""}`}
        >
          {band(machine)}
        </span>
      ) : null}
      {editable ? (
        <input
          className={`${styles.criterionField} ${invalid ? styles.criterionFieldInvalid : ""}`}
          type="text"
          inputMode="decimal"
          value={draft ?? band(value)}
          aria-label={`Điểm giáo viên cho ${name}, 0 đến 9, bước 0.5`}
          aria-invalid={invalid || undefined}
          onFocus={(event) => {
            setDraft(value === undefined ? "" : band(value));
            event.currentTarget.select();
          }}
          onChange={(event) => {
            const raw = event.target.value.replace(",", ".");
            setDraft(raw);
            const parsed = Number(raw);
            onChange?.(raw === "" || Number.isNaN(parsed) ? undefined : parsed);
          }}
          onBlur={() => setDraft(null)}
        />
      ) : (
        <span className={styles.criterionValue}>{band(value)}</span>
      )}
      {printed ? (
        <span className={`${styles.deviation} ${invalid ? "" : diffClass}`}>
          {invalid || diff === null ? "" : signedBand(diff)}
        </span>
      ) : null}
    </div>
  );
}

export function Blank({
  art,
  title,
  children,
}: {
  art: "writing" | "reading" | "listening" | "speaking" | "404";
  title: string;
  children?: ReactNode;
}) {
  const src = art === "404" ? "/404.png" : `/assignment-${art}.png`;
  return (
    <div className={styles.blank}>
      <Image src={src} alt="" width={1500} height={1500} className={styles.blankArt} />
      <p className={styles.blankTitle}>{title}</p>
      {children ? <p className={styles.blankText}>{children}</p> : null}
    </div>
  );
}

export function WaitingRack({ rows = 4 }: { rows?: number }) {
  return (
    <div className={styles.skeletonRack} aria-live="polite" aria-busy="true">
      <span className={styles.label}>Đang lấy bảng…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.skeletonStrip} />
      ))}
    </div>
  );
}

export function Notice({
  tone = "plain",
  children,
}: {
  tone?: "plain" | "alert" | "ok";
  children: ReactNode;
}) {
  const toneClass =
    tone === "alert" ? styles.noticeAlert : tone === "ok" ? styles.noticeOk : "";
  return (
    <p className={`${styles.notice} ${toneClass}`} role={tone === "alert" ? "alert" : undefined}>
      {children}
    </p>
  );
}
