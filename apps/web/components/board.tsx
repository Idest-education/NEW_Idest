"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import {
  BAY_LABEL,
  CRITERIA,
  CRITERION_ABBR,
  type Criterion,
  type Scores,
  type SubmissionStatus,
} from "../lib/idest";
import { band, deviation, isBand, signedBand, stripRef } from "../lib/format";
import { pagerSlots } from "../lib/pager";
import { Masthead } from "./masthead";
import { TourSpot } from "./tour-spot";
import { FeedbackPrompt } from "./feedback-prompt";
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
      {role === "teacher" ? (
        <>
          <Suspense fallback={null}>
            <TourSpot />
          </Suspense>
          <FeedbackPrompt />
        </>
      ) : null}
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
  abuse: styles.stripFailed,
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

export type ImageDropzoneStatus = "empty" | "staged" | "uploading" | "uploaded" | "error";

export function ImageDropzone({
  id,
  previewUrl,
  status,
  fileName,
  fileSize,
  errorMessage,
  hint = "PNG hoặc JPG, tối đa 5MB",
  disabled,
  onSelect,
  onClear,
}: {
  id: string;
  previewUrl?: string | null;
  status: ImageDropzoneStatus;
  fileName?: string;
  fileSize?: string;
  errorMessage?: string;
  hint?: string;
  disabled?: boolean;
  onSelect: (file: File) => void;
  onClear?: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const hasImage = status !== "empty";

  const pick = () => {
    if (disabled) return;
    document.getElementById(id)?.click();
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onSelect(file);
  };

  const badgeClass =
    status === "staged"
      ? styles.dropzoneBadgeStaged
      : status === "uploaded"
        ? styles.dropzoneBadgeUploaded
        : status === "error"
          ? styles.dropzoneBadgeError
          : "";

  const badgeText =
    status === "staged"
      ? "Sẽ tải lên khi lưu"
      : status === "uploading"
        ? "Đang tải lên…"
        : status === "uploaded"
          ? "✓ Đã lưu ảnh"
          : status === "error"
            ? "Tải lên lỗi"
            : "";

  return (
    <div
      className={`${styles.dropzone} ${hasImage ? styles.dropzoneFilled : ""} ${
        dragging ? styles.dropzoneDragging : ""
      }`}
      role={hasImage ? undefined : "button"}
      tabIndex={hasImage || disabled ? undefined : 0}
      onClick={!hasImage ? pick : undefined}
      onKeyDown={
        !hasImage
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick();
              }
            }
          : undefined
      }
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        id={id}
        type="file"
        accept="image/*"
        className={styles.dropzoneInput}
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
      />
      {!hasImage ? (
        <>
          <span className={styles.dropzoneIcon} aria-hidden="true">
            ⇪
          </span>
          <span className={styles.dropzoneLabel}>Kéo ảnh vào đây, hoặc bấm để chọn</span>
          <span className={styles.dropzoneHint}>{hint}</span>
        </>
      ) : (
        <div className={styles.dropzonePreviewWrap}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className={styles.dropzoneThumb} />
          ) : null}
          <div className={styles.dropzoneMeta}>
            {fileName ? <span className={styles.dropzoneFileName}>{fileName}</span> : null}
            {fileSize ? <span className={styles.dropzoneFileSize}>{fileSize}</span> : null}
            <span className={`${styles.dropzoneBadge} ${badgeClass}`}>{badgeText}</span>
            {status === "error" && errorMessage ? (
              <span className={styles.dropzoneFileSize}>{errorMessage}</span>
            ) : null}
            <div className={styles.dropzoneActions}>
              <button
                type="button"
                className={styles.pressQuiet}
                disabled={disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  pick();
                }}
              >
                Đổi ảnh
              </button>
              {onClear ? (
                <button
                  type="button"
                  className={styles.pressQuiet}
                  disabled={disabled}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClear();
                  }}
                >
                  Xóa
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function Wizard({
  open,
  onClose,
  title,
  steps,
  step = 0,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  steps?: string[];
  step?: number;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={styles.wizardOverlay} onClick={onClose}>
      <div
        className={styles.wizardPanel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.wizardHead}>
          <div>
            <h2 className={styles.wizardTitle}>{title}</h2>
            {steps && steps.length > 1 ? (
              <div className={styles.wizardSteps}>
                {steps.map((label, i) => (
                  <span
                    key={label}
                    className={`${styles.wizardStep} ${i === step ? styles.wizardStepActive : ""} ${
                      i < step ? styles.wizardStepDone : ""
                    }`}
                  >
                    <span className={styles.wizardStepDot}>{i + 1}</span>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className={styles.wizardClose} onClick={onClose} aria-label="Đóng">
            ×
          </button>
        </div>

        <div className={styles.wizardBody}>{children}</div>

        {footer ? <div className={styles.wizardFooter}>{footer}</div> : null}
      </div>
    </div>
  );
}

export function ActionMenu({
  label = "Tùy chọn",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.actionMenu} ref={ref}>
      <button
        type="button"
        className={styles.actionMenuTrigger}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">☰</span>
      </button>
      {open ? (
        <div className={styles.actionMenuPanel} role="menu" onClick={() => setOpen(false)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Pager({
  page,
  totalPages,
  onPage,
  label = "Phân trang",
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className={styles.pager} aria-label={label}>
      <button type="button" className={styles.pressQuiet} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        ← Trước
      </button>
      <span className={styles.pagerPages}>
        {pagerSlots(page, totalPages).map((slot, i) =>
          slot === "gap" ? (
            <span key={`gap-${i}`} className={styles.pagerGap} aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={slot}
              type="button"
              className={`${styles.pagerNum} ${slot === page ? styles.pagerNumActive : ""}`}
              aria-current={slot === page ? "page" : undefined}
              aria-label={`Trang ${slot}`}
              onClick={() => slot !== page && onPage(slot)}
            >
              {slot}
            </button>
          ),
        )}
      </span>
      <span className={`${styles.pagerInfo} ${styles.pagerInfoCompact}`}>
        Trang {page} / {totalPages}
      </span>
      <button
        type="button"
        className={styles.pressQuiet}
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Sau →
      </button>
    </nav>
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
