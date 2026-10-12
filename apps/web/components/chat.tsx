"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { describeError } from "../lib/api";
import { useApi, useLoad } from "../lib/use-api";
import { Icon } from "./icon";
import { Io } from "./io";
import { useAccount } from "./session";
import styles from "./chat.module.css";

const MAX_CHARS = 1000;

/** Follow-up questions about a graded essay. Hidden from anyone but the essay's owner. */
export function Chat({ id }: { id: string }) {
  const api = useApi();
  const { signedIn } = useAccount();
  const { data, error, reload } = useLoad(
    `chat:${id}:${signedIn}`,
    () => api.chat(id),
    (d) => d.turns.some((t) => t.status === "pending"),
    2500,
  );
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Not the owner, or the thread failed to load: the result still stands on its own.
  if (!data) return error ? null : <div className="skeleton" style={{ height: 120 }} aria-busy="true" />;

  const waiting = data.turns.some((t) => t.status === "pending");
  const out = data.remaining === 0;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setSendError(null);
    try {
      await api.ask(id, q);
      setQuestion("");
    } catch (err) {
      setSendError(describeError(err));
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <section className={styles.chat} aria-label="Ask Io about this essay">
      <div className={styles.head}>
        <h2 className={styles.title}>Ask Io about this essay</h2>
        <span className="hint num" role="status">
          {data.remaining} of {data.limit} {data.limit === 1 ? "question" : "questions"} left
        </span>
      </div>

      {data.turns.map((t) => (
        <div key={t.id} className={styles.turn}>
          <p className={styles.question}>{t.question}</p>
          <div className={styles.answer}>
            <Io mood={t.status === "failed" ? "oops" : t.status === "pending" ? "reading" : "idle"} size={32} />
            {t.status === "answered" && <p className={styles.answerText}>{t.answer}</p>}
            {t.status === "pending" && <p className="muted">Io is thinking…</p>}
            {t.status === "failed" && (
              <p className="muted">Io couldn&apos;t answer this one. It doesn&apos;t count, so ask again.</p>
            )}
          </div>
        </div>
      ))}

      {!out && (
        <form className={styles.form} onSubmit={send}>
          <label className="sr-only" htmlFor="chat-question">
            Your question
          </label>
          <textarea
            id="chat-question"
            className="textarea"
            rows={2}
            maxLength={MAX_CHARS}
            placeholder="e.g. Why is my Lexical Resource 6? How do I fix my second paragraph?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={waiting}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || waiting || !question.trim()}>
            <Icon name="arrow_upward" /> {busy ? "Sending" : "Ask"}
          </button>
        </form>
      )}
      {sendError && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {sendError}
        </p>
      )}

      {!signedIn && (
        <div className={`alert alert-mark ${styles.upsell}`}>
          <Icon name="info" />
          <span>
            {out ? "You've used your free question. " : "Free visitors get 1 question per essay. "}
            Sign up free to ask up to 5 questions per essay and grade more essays every day.
          </span>
          <Link className="btn btn-primary btn-sm" href="/sign-up">
            Sign up
          </Link>
        </div>
      )}
    </section>
  );
}
