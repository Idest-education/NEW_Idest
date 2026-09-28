"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { dismissFeedbackPrompt, getFeedback, type FeedbackState } from "../lib/idest";
import { promptAllowedOn } from "../lib/feedback";
import { useResource } from "../lib/use-api";
import styles from "./board.module.css";
import p from "./feedback-prompt.module.css";

/**
 * Asks a teacher for survey feedback once they have graded 10, 20, 30…
 * submissions. Never mounted on the survey or an open review, and never shown
 * while loading or after an error: it must not stand between a teacher and
 * grading.
 */
export function FeedbackPrompt() {
  const pathname = usePathname();
  if (!promptAllowedOn(pathname)) return null;
  return <PromptDialog />;
}

function PromptDialog() {
  const { data, state } = useResource<FeedbackState>((token) => getFeedback(token));
  const { getToken } = useAuth();
  const router = useRouter();
  const [closed, setClosed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLButtonElement>(null);
  const open = !closed && state === "ready" && data?.prompt === true;

  const record = useCallback(async () => {
    try {
      await dismissFeedbackPrompt(await getToken());
    } catch (err) {
      console.warn("Could not record the feedback pop-up dismissal", err);
    }
  }, [getToken]);

  const close = useCallback(() => {
    setClosed(true);
    void record();
  }, [record]);

  const start = async () => {
    setClosed(true);
    await record();
    router.push("/feedback");
  };

  useEffect(() => {
    if (open) ctaRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>("button");
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || !data) return null;

  return (
    <div className={styles.wizardOverlay}>
      <div
        ref={panelRef}
        className={`${styles.wizardPanel} ${p.panel}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-prompt-title"
        aria-describedby="feedback-prompt-text"
      >
        <button type="button" className={`${styles.wizardClose} ${p.close}`} onClick={close} aria-label="Đóng">
          ×
        </button>
        <h2 id="feedback-prompt-title" className={styles.wizardTitle}>
          Idest đang giúp bạn thế nào?
        </h2>
        <p id="feedback-prompt-text" className={p.text}>
          Bạn đã chấm {data.gradedCount} bài với Idest. Dành khoảng 6 phút cho chúng tôi biết Idest đang giúp bạn
          thế nào?
        </p>
        <div className={styles.actionRow}>
          <button ref={ctaRef} type="button" className={styles.press} onClick={() => void start()}>
            Làm khảo sát
          </button>
        </div>
      </div>
    </div>
  );
}
