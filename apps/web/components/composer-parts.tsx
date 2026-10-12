"use client";

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import type { TaskType } from "../lib/api";
import { fileSize } from "../lib/format";
import { Icon } from "./icon";
import styles from "./composer.module.css";

export const IMAGE_TYPES = "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif";

export function TaskToggle({ value, onChange }: { value: TaskType; onChange: (t: TaskType) => void }) {
  const name = useId();
  return (
    <fieldset className={styles.toggle}>
      <legend className="sr-only">Task type</legend>
      {(["task_1", "task_2"] as const).map((t) => (
        <label key={t} className={styles.toggleOption}>
          <input type="radio" name={name} value={t} checked={value === t} onChange={() => onChange(t)} />
          <span>{t === "task_1" ? "Task 1" : "Task 2"}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** The image in a paste, if any (screenshots arrive as files). Returns null for text pastes. */
export function pastedImage(e: ClipboardEvent): File | null {
  const file = [...e.clipboardData.files].find((f) => IMAGE_TYPES.split(",").includes(f.type));
  if (!file) return null;
  e.preventDefault();
  // Clipboard images are all called "image.png"; give them a name a teacher can recognise.
  return new File([file], file.name && file.name !== "image.png" ? file.name : "pasted-chart.png", { type: file.type });
}

/** Optional Task 1 chart: a button that becomes a thumbnail chip once chosen. */
export function ChartPicker({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  // Derived from `file`, so a chart pasted into the composer previews too.
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  const choose = onChange;

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES}
        hidden
        onChange={(e) => {
          choose(e.target.files?.[0] ?? null);
          e.target.value = "";
        }}
      />
      {file && preview ? (
        <span className={styles.attachment}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={preview} alt="" className={styles.thumb} />
          <span className={styles.attachmentName}>{file.name}</span>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Remove chart" onClick={() => choose(null)}>
            <Icon name="close" />
          </button>
        </span>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => input.current?.click()}>
          <Icon name="add_photo_alternate" /> Chart image <span className="hint">or paste</span>
        </button>
      )}
    </>
  );
}

const BATCH_EXT = /\.(png|jpe?g|webp|gif|heic|heif|pdf|docx?|xlsx?|csv)$/i;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Picks or drops batch files; rejects unsupported or oversized files with a reason. */
export function DropZone({
  files,
  onChange,
  max,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  max: number;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const add = (list: FileList | null) => {
    if (!list) return;
    const incoming = [...list];
    const bad = incoming.filter((f) => !BATCH_EXT.test(f.name));
    const big = incoming.filter((f) => f.size > MAX_FILE_BYTES);
    const ok = incoming.filter((f) => !bad.includes(f) && !big.includes(f));
    const next = [...files, ...ok].slice(0, max);
    const notes = [
      bad.length && `${bad.map((f) => f.name).join(", ")}: not a supported type.`,
      big.length && `${big.map((f) => f.name).join(", ")}: over 20 MB.`,
      files.length + ok.length > max && `Only ${max} more file${max === 1 ? "" : "s"} fit in this batch.`,
    ].filter(Boolean);
    setProblem(notes.length ? notes.join(" ") : null);
    onChange(next);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className="stack">
      <label
        htmlFor={id}
        className={styles.drop}
        data-over={over || undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Icon name="upload_file" className={styles.dropIcon} />
        <span className={styles.dropTitle}>Drop files here, or choose files</span>
        <span className="hint">Photos, PDF, Word (.doc, .docx), Excel (.xls, .xlsx, .csv) · up to {max} · 20 MB each</span>
        <input
          id={id}
          type="file"
          multiple
          className="sr-only"
          accept=".png,.jpg,.jpeg,.webp,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.csv"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {problem && (
        <p className="alert alert-mark" role="alert">
          <Icon name="info" /> {problem}
        </p>
      )}
      {files.length > 0 && (
        <ul className={styles.fileList}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className={styles.fileRow}>
              <Icon name={/\.(xlsx?|csv)$/i.test(f.name) ? "table" : /\.(pdf|docx?)$/i.test(f.name) ? "description" : "image"} />
              <span className={styles.attachmentName}>{f.name}</span>
              <span className="hint num">{fileSize(f.size)}</span>
              <button
                type="button"
                className="btn btn-ghost btn-icon btn-sm"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <Icon name="close" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
