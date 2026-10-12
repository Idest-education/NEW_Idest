"use client";

import Link from "next/link";
import { useState } from "react";
import { ApiError, describeError } from "../lib/api";
import { isWorking, shortDate, taskLabel } from "../lib/format";
import { EssayText } from "./essay-text";
import { useApi, useLoad } from "../lib/use-api";
import { Assessment } from "./assessment";
import { Chat } from "./chat";
import { Icon } from "./icon";
import { Io, type IoMood } from "./io";
import { useToast } from "./toast";
import Image from "next/image";
import gradingFailed from "../public/illustrations/grading-failed.webp";
import { isTeacher, Notice, useAccount } from "./session";
import styles from "./result-view.module.css";

export function ResultView({ id }: { id: string }) {
  const api = useApi();
  const { profile } = useAccount();
  const [notFound, setNotFound] = useState(false);
  const { data, error, reload } = useLoad(
    `result:${id}`,
    () =>
      api.result(id).catch((err) => {
        if (err instanceof ApiError && (err.status === 404 || err.status === 400)) setNotFound(true);
        throw err;
      }),
    (d) => isWorking(d.status) || (d.status === "published" && !d.result),
    2500,
  );
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);

  if (notFound) {
    return (
      <Notice io="lost" title="We couldn't find that result" body="The link may be incomplete. Check it, or grade a new essay.">
        <Link className="btn btn-primary" href="/">
          Grade an essay
        </Link>
      </Notice>
    );
  }
  if (error && !data) {
    return (
      <Notice io="oops" title="We couldn't load this result" body={error}>
        <button className="btn btn-secondary" onClick={reload}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!data) {
    return (
      <div className={styles.thread} aria-busy="true">
        <div className={`skeleton ${styles.userSkeleton}`} />
        <div className="skeleton" style={{ height: 160 }} />
      </div>
    );
  }

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      await api.retryGrading(id);
      reload();
    } catch (err) {
      setRetryError(describeError(err));
    } finally {
      setRetrying(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied. Anyone with it can see this result.");
    } catch {
      toast("Copy the address from the address bar to share.", "info");
    }
  };

  const long = data.essayText.length > 900;
  const fixes = data.result?.feedback.sentence_feedback ?? [];

  return (
    <div className={styles.thread}>
      <article className={styles.user} aria-label="Your essay">
        <p className={styles.meta}>
          You · {taskLabel(data.taskType)} · <span className="num">{data.wordCount}</span> words · {shortDate(data.submittedAt)}
        </p>
        <p className={styles.prompt}>{data.taskPrompt}</p>
        {data.taskImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- remote chart from the API host
          <img src={data.taskImageUrl} alt="Task 1 chart" className={styles.chart} />
        )}
        <div className={styles.essay} data-clamped={long && !expanded ? "" : undefined}>
          <EssayText text={data.essayText} comments={fixes} taskType={data.taskType} />
        </div>
        {fixes.length > 0 && (
          <p className="hint">Hover or tap a highlighted sentence to see how to fix it.</p>
        )}
        {long && (
          <button className="btn btn-ghost btn-sm" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
            {expanded ? "Show less" : "Show full essay"}
          </button>
        )}
      </article>

      <article className={styles.reply} aria-label="Assessment">
        <div className={styles.avatar}>
          <Io mood={replyMood(data)} size={48} />
        </div>
        <div className={styles.replyBody}>
          <div aria-live="polite" role="status" className={styles.live}>
            {isWorking(data.status) && <Working status={data.status} />}
          </div>

          {data.status === "submitted" && !data.result && (
            <Problem
              title="Your essay is saved, but it hasn't reached the grader yet."
              body="This happens when grading is busy. Send it again."
              onRetry={retry}
              retrying={retrying}
            />
          )}
          {data.status === "failed" && (
            <Problem
              title="Io tripped over this one."
              body="Your essay is safe. Trying again usually works."
              onRetry={retry}
              retrying={retrying}
            />
          )}
          {retryError && (
            <p className="alert alert-danger" role="alert">
              <Icon name="error" /> {retryError}
            </p>
          )}

          {data.result && <Assessment scores={data.result.scores} feedback={data.result.feedback} by={data.result.by} taskType={data.taskType} />}

          <div className={styles.actions}>
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              <Icon name="content_copy" /> Copy link
            </button>
            <Link className="btn btn-secondary btn-sm" href="/">
              <Icon name="edit_square" /> Grade another
            </Link>
            {isTeacher(profile) && data.result && (
              <Link className="btn btn-ghost btn-sm" href={`/review/${id}`}>
                Review and edit
              </Link>
            )}
          </div>

          {data.result && <Chat id={id} />}
        </div>
      </article>
    </div>
  );
}

function replyMood(d: { status: string; result: { scores: { overall: number } } | null }): IoMood {
  if (d.result) return d.result.scores.overall >= 7 ? "celebrate" : "idle";
  if (d.status === "failed" || d.status === "submitted") return "oops";
  return "scoring";
}

function Working({ status }: { status: "queued" | "scoring" | string }) {
  return (
    <div className={styles.working}>
      <div>
        <p className={styles.workingTitle}>
          {status === "queued" ? "Grading in progress" : "Reading your essay against the four criteria"}
        </p>
        <p className="hint">Io usually takes under a minute. You can leave this page; the link keeps working.</p>
      </div>
    </div>
  );
}

function Problem({
  title,
  body,
  onRetry,
  retrying,
}: {
  title: string;
  body: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div className={styles.problem} role="alert">
      <Image src={gradingFailed} alt="" sizes="240px" style={{ width: 240, height: "auto", maxWidth: "100%" }} />
      <p className={styles.workingTitle}>{title}</p>
      <p className="muted">{body}</p>
      <button className="btn btn-primary btn-sm" onClick={onRetry} disabled={retrying}>
        <Icon name="refresh" /> {retrying ? "Sending" : "Try again"}
      </button>
    </div>
  );
}
