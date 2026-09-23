"use client";

import { useEffect, useState } from "react";
import {
  NO_SCORE_CHANGE,
  REASON_CODES,
  REASON_LABEL,
  type RevisionReason,
  canSubmitBatch,
  describeScoreChanges,
  toggle,
} from "../lib/reason-codes";
import { type UntaggedRevision, tagRevisionsBatch } from "../lib/idest";
import { stamp } from "../lib/format";
import { useAction } from "../lib/use-api";
import { Notice, Wizard, board as s } from "./board";

/**
 * Sits on the assignment desk whenever revisions are waiting for a reason.
 * Purely an invitation: nothing in grading or publishing depends on it.
 */
export function UntaggedBadge({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count < 1) return null;
  return (
    <button type="button" className={s.pressQuiet} onClick={onOpen}>
      {count} bản sửa chưa ghi lý do
    </button>
  );
}

/**
 * Collects reason codes for a batch of revisions, with every revision on screen.
 *
 * Each row is pre-checked and carries the student, what moved, and what the
 * teacher wrote at the time, so unchecking one is a judgement rather than a
 * guess. Applying a single reason set blind to a dozen different overrides
 * would flatten them into uniform noise, which is worse evidence than leaving
 * them untagged — so this is never an apply-to-all control.
 */
export function ReasonBatchModal({
  open,
  onClose,
  revisions,
  onTagged,
}: {
  open: boolean;
  onClose: () => void;
  revisions: UntaggedRevision[];
  onTagged: () => Promise<void> | void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [codes, setCodes] = useState<RevisionReason[]>([]);
  const [note, setNote] = useState("");
  const { busy, error, setError, run } = useAction();

  // A joined string, not the array, so the effect does not re-run on every
  // render just because the parent rebuilt an equivalent list.
  const ids = revisions.map((revision) => revision.id).join(",");

  useEffect(() => {
    if (!open) return;
    setPicked(ids ? ids.split(",") : []);
    setCodes([]);
    setNote("");
    setError(null);
  }, [open, ids, setError]);

  const submit = async () => {
    const done = await run((token) =>
      tagRevisionsBatch(token, {
        revisionIds: picked,
        reasonCodes: codes,
        note: note.trim() || undefined,
      }),
    );
    if (!done) return;
    await onTagged();
    onClose();
  };

  return (
    <Wizard
      open={open}
      onClose={onClose}
      title="Vì sao bạn sửa điểm của AI?"
      footer={
        <>
          <button type="button" className={s.pressQuiet} onClick={onClose}>
            Để sau
          </button>
          <button
            type="button"
            className={s.press}
            disabled={busy || !canSubmitBatch(picked, codes)}
            onClick={submit}
          >
            {busy ? "Đang lưu…" : `Ghi lý do cho ${picked.length} bản sửa`}
          </button>
        </>
      }
    >
      <p className={s.fieldHint}>
        Phần này chỉ dùng để đo chất lượng của AI. Học viên không bao giờ nhìn thấy, và bạn có thể
        bỏ qua bất cứ lúc nào.
      </p>

      {revisions.length === 0 ? (
        <Notice tone="plain">Không còn bản sửa nào chờ ghi lý do.</Notice>
      ) : (
        <>
          <section className={s.railBlock} style={{ marginTop: "0.8rem" }}>
            <header className={s.railHead}>
              <span className={s.label}>Các bản sửa</span>
              <span className={s.paperTag}>
                {picked.length}/{revisions.length}
              </span>
            </header>
            <div className={s.noteList}>
              {revisions.map((revision) => {
                const lines = describeScoreChanges(revision.changes?.score_changes);
                return (
                  <label
                    key={revision.id}
                    className={`${s.adopt} ${picked.includes(revision.id) ? s.adoptTaken : ""}`}
                  >
                    <input
                      type="checkbox"
                      className={s.adoptBox}
                      checked={picked.includes(revision.id)}
                      onChange={() => setPicked((prev) => toggle(prev, revision.id))}
                    />
                    <div>
                      <span className={s.rosterName}>{revision.submission.student.displayName}</span>
                      <div className={s.rosterMeta}>
                        lần {revision.submission.attemptNumber} · {stamp(revision.createdAt)}
                      </div>
                      <div className={s.timelineMeta}>
                        {lines.length > 0 ? lines.join(" · ") : NO_SCORE_CHANGE}
                      </div>
                      {revision.revisionNote ? (
                        <div className={s.machineNote} style={{ marginTop: "0.35rem" }}>
                          {revision.revisionNote}
                        </div>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          </section>

          <section className={s.railBlock} style={{ marginTop: "0.8rem" }}>
            <header className={s.railHead}>
              <span className={s.label}>Lý do</span>
              <span className={s.paperTag}>chọn một hoặc nhiều</span>
            </header>
            <div className={s.noteList}>
              {REASON_CODES.map((code) => (
                <label
                  key={code}
                  className={`${s.adopt} ${codes.includes(code) ? s.adoptTaken : ""}`}
                >
                  <input
                    type="checkbox"
                    className={s.adoptBox}
                    checked={codes.includes(code)}
                    onChange={() => setCodes((prev) => toggle(prev, code))}
                  />
                  <span>{REASON_LABEL[code]}</span>
                </label>
              ))}
            </div>

            <div className={s.fieldRow} style={{ marginTop: "0.8rem" }}>
              <label className={s.fieldLabel} htmlFor="reason-note">
                Ghi chú thêm (không bắt buộc)
              </label>
              <textarea
                id="reason-note"
                className={s.field}
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="AI cho 7.0 Task Response nhưng bài chỉ trả lời một vế của đề."
              />
            </div>
          </section>
        </>
      )}

      {error ? <Notice tone="alert">{error}</Notice> : null}
    </Wizard>
  );
}
