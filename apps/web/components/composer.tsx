"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type ClipboardEvent, type FormEvent } from "react";
import { describeError, type TaskType } from "../lib/api";
import { countWords } from "../lib/format";
import { useApi } from "../lib/use-api";
import { ChartPicker, IMAGE_TYPES, pastedImage, TaskToggle } from "./composer-parts";
import { useToast } from "./toast";
import { Icon } from "./icon";
import { Io } from "./io";
import { useAccount } from "./session";
import styles from "./composer.module.css";

// The server treats 20 words or fewer as abuse; stop short text here with a kinder message.
const MIN_WORDS = 21;
const MAX_WORDS = 1500;
const MAX_PHOTOS = 5;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const noop = () => () => {};
const isLate = (h: number) => h >= 22 || h < 5;

function greet(hour: number, name?: string) {
  if (isLate(hour)) return name ? `Working late, ${name}? Io too.` : "Working late? Io too.";
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}.` : `${part}.`;
}

type Photos = { state: "reading" } | { state: "done"; id: string } | { state: "failed"; message: string };

/** `landing` drops Io and the greeting, because the marketing hero above already says hello. */
export function Composer({ variant = "app" }: { variant?: "app" | "landing" }) {
  const api = useApi();
  const router = useRouter();
  const { profile, bumpRecents } = useAccount();
  // The server has no idea of the visitor's clock; it renders the afternoon greeting.
  const hour = useSyncExternalStore(
    noop,
    () => new Date().getHours(),
    () => 14,
  );

  const [taskType, setTaskType] = useState<TaskType>("task_2");
  const [prompt, setPrompt] = useState("");
  const [chart, setChart] = useState<File | null>(null);
  const [essay, setEssay] = useState("");
  const [photos, setPhotos] = useState<Photos | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const attempt = useRef<{ sig: string; key: string } | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const toast = useToast();
  const words = countWords(essay);

  const onPaste = (e: ClipboardEvent) => {
    const image = pastedImage(e);
    if (!image) return;
    toast(taskType === "task_1" ? "Chart added." : "Chart added. Switched to Task 1.");
    setTaskType("task_1");
    setChart(image);
  };
  const name = profile?.displayName?.split(" ")[0];

  async function readPhotos(files: File[]) {
    setError(null);
    if (files.length > MAX_PHOTOS) return setError(`Add up to ${MAX_PHOTOS} photos, in page order.`);
    if (files.some((f) => f.size > MAX_PHOTO_BYTES)) return setError("Each photo must be under 10 MB.");
    setPhotos({ state: "reading" });
    setChecked(false);
    try {
      const { id } = await api.transcribe(files);
      // Transcription runs on the server; check every 2 s for up to 3 minutes.
      for (let i = 0; i < 90 && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const t = await api.transcription(id);
        if (t.failed)
          throw new Error("We couldn't read those photos. Try sharper, well-lit photos, or type the essay.");
        if (t.status === "extracted") {
          if (!alive.current) return;
          setEssay(t.text ?? "");
          if (t.taskPrompt) setPrompt((p) => p || t.taskPrompt!);
          setPhotos({ state: "done", id });
          return;
        }
      }
      throw new Error("Reading the photos is taking too long. Try again in a minute.");
    } catch (err) {
      if (alive.current) setPhotos({ state: "failed", message: describeError(err) });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!prompt.trim()) return setError("Add the question, so the essay is graded against it.");
    if (words < MIN_WORDS) return setError("This is not an essay.");
    if (words > MAX_WORDS)
      return setError(`The essay is over ${MAX_WORDS.toLocaleString("en")} words. Trim it, then try again.`);
    if (photos?.state === "done" && !checked)
      return setError("Check the transcript against your photos, then tick the box.");

    // Same content keeps the same key, so a resend after a network error never grades twice.
    const sig = JSON.stringify([taskType, prompt, essay, chart?.name, chart?.size]);
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: crypto.randomUUID() };

    setBusy(true);
    try {
      const { id } = await api.grade({
        taskType,
        taskPrompt: prompt.trim(),
        essayText: essay,
        idempotencyKey: attempt.current.key,
        transcriptionId: photos?.state === "done" ? photos.id : undefined,
        taskImage: taskType === "task_1" && chart ? chart : undefined,
      });
      bumpRecents();
      router.push(`/r/${id}`);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  }

  return (
    <div className={variant === "app" ? styles.wrap : styles.embedded}>
      {variant === "app" && (
        <>
          <Io
            mood={
              photos?.state === "reading"
                ? "reading"
                : photos?.state === "failed"
                  ? "oops"
                  : isLate(hour)
                    ? "sleepy"
                    : "idle"
            }
            size={84}
            boopable
            className={styles.io}
          />
          <h1 className={styles.greeting}>{greet(hour, name)} What are we grading?</h1>
        </>
      )}

      <form className={styles.card} onSubmit={submit} onPaste={onPaste} noValidate aria-describedby="privacy">
        <div className={styles.head}>
          <TaskToggle value={taskType} onChange={setTaskType} />
          {taskType === "task_1" && <ChartPicker file={chart} onChange={setChart} />}
        </div>

        <label className="sr-only" htmlFor="question">
          Question (required)
        </label>
        <textarea
          id="question"
          className={`${styles.bare} ${styles.question}`}
          placeholder={
            taskType === "task_1"
              ? "The question, e.g. The chart below shows… Summarise the information…"
              : "The question, e.g. Some people think… To what extent do you agree?"
          }
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          required
          rows={2}
          maxLength={4000}
        />

        <label className="sr-only" htmlFor="essay">
          Essay
        </label>
        <textarea
          id="essay"
          className={`${styles.bare} ${styles.essay}`}
          placeholder={photos?.state === "reading" ? "Reading your photos…" : "Paste or type the essay here…"}
          value={essay}
          onChange={(e) => setEssay(e.target.value)}
          disabled={photos?.state === "reading"}
          rows={11}
        />

        {photos?.state === "done" && (
          <div className={styles.transcript}>
            <p className="alert alert-mark">
              <Icon name="info" />
              <span>
                We typed this from your photos. Check it against the paper and fix any mistakes before grading.
              </span>
            </p>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setChecked(e.target.checked);
                  setError(null);
                }}
              />
              I&apos;ve checked the transcript
            </label>
          </div>
        )}

        <div className={styles.foot}>
          <input
            ref={photoInput}
            type="file"
            accept={IMAGE_TYPES}
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void readPhotos(files);
            }}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => photoInput.current?.click()}
            disabled={photos?.state === "reading" || busy}
          >
            <Icon name="photo_camera" /> Photos
          </button>
          <span className="hint" role="status" aria-live="polite">
            {photos?.state === "reading" && "Reading your photos. This takes up to a minute."}
          </span>
          <span className={styles.spacer} />
          <span
            className={`${styles.count} num ${essay && (words < MIN_WORDS || words > MAX_WORDS) ? styles.countBad : ""}`}
          >
            {words.toLocaleString("en")} / {MAX_WORDS.toLocaleString("en")} words
          </span>
          <button
            type="submit"
            className={`btn btn-primary ${styles.send}`}
            disabled={busy || photos?.state === "reading"}
          >
            {busy ? <Icon name="progress_activity" className={styles.spin} /> : <Icon name="arrow_upward" />}
            {busy ? "Sending" : "Grade"}
          </button>
        </div>

        {(error || photos?.state === "failed") && (
          <p className="alert alert-danger" role="alert" style={{ margin: 4 }}>
            <Icon name="error" /> <span>{error ?? (photos?.state === "failed" ? photos.message : "")}</span>
          </p>
        )}
      </form>

      <p id="privacy" className={styles.privacy}>
        We store essays and results to improve grading. Anyone with a result link can open it.
      </p>
    </div>
  );
}
