"use client";

import { useEffect, useRef, useState } from "react";
import { CRITERIA, describeError, REASON_CODES, type ReasonCode, type UntaggedRevision } from "../lib/api";
import { useApi } from "../lib/use-api";
import { Icon } from "./icon";
import { useToast } from "./toast";
import styles from "./reason-tagger.module.css";

const SHORT = Object.fromEntries(CRITERIA.map((c) => [c.key, c.short])) as Record<string, string>;

function changeText(r: UntaggedRevision) {
  const changes = r.changes?.score_changes ?? [];
  if (changes.length === 0) return "Feedback edited";
  return changes.map((c) => `${SHORT[c.criterion] ?? "Overall"} ${c.from} → ${c.to}`).join(", ");
}

/** Optional "why did you change the score" tags for several revisions at once. */
export function ReasonTagger({ revisions, onClose }: { revisions: UntaggedRevision[]; onClose: (saved: boolean) => void }) {
  const api = useApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<string[]>(revisions.map((r) => r.id));
  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.tagRevisions({ revisionIds: picked, reasonCodes: reasons, note: note.trim() || undefined });
      toast("Reasons saved. Thank you, that helps Io learn.");
      onClose(true);
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="reasons-title" onClose={() => onClose(false)}>
      <div className={styles.head}>
        <h2 id="reasons-title">Why did you change these scores?</h2>
        <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={() => dialog.current?.close()}>
          <Icon name="close" />
        </button>
      </div>
      <p className="muted">Optional. Pick the changes that share a reason, then tag them together.</p>

      <fieldset className={styles.group}>
        <legend className="label">Changes</legend>
        {revisions.map((r) => (
          <label key={r.id} className={styles.option}>
            <input type="checkbox" checked={picked.includes(r.id)} onChange={() => setPicked((p) => toggle(p, r.id))} />
            <span>
              <strong>{r.submission.sourceRef?.studentLabel || "Essay"}</strong>{" "}
              <span className="muted num">{changeText(r)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className={styles.group}>
        <legend className="label">Reasons</legend>
        <div className={styles.chips}>
          {REASON_CODES.map((r) => (
            <label key={r.code} className={styles.chip}>
              <input type="checkbox" checked={reasons.includes(r.code)} onChange={() => setReasons((p) => toggle(p, r.code))} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor="reason-note">
          Note <span className="hint">(optional)</span>
        </label>
        <textarea id="reason-note" className="textarea" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {error && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {error}
        </p>
      )}

      <div className={styles.foot}>
        <button className="btn btn-ghost" onClick={() => dialog.current?.close()}>
          Skip
        </button>
        <button className="btn btn-primary" onClick={save} disabled={busy || picked.length === 0 || reasons.length === 0}>
          {busy ? "Saving" : `Tag ${picked.length}`}
        </button>
      </div>
    </dialog>
  );
}
