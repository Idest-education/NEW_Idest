"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { categoryLabel, CRITERIA, criterionName, type SentenceFeedback, type TaskType } from "../lib/api";
import { markPhrases } from "../lib/format";
import { Icon } from "./icon";
import styles from "./essay-text.module.css";

type Pos = { left: number; top?: number; bottom?: number };
type Open =
  | ({ kind: "read"; index: number } & Pos)
  | ({ kind: "edit"; index: number } & Pos)
  | ({ kind: "add"; text: string } & Pos)
  | ({ kind: "new"; text: string } & Pos);

const POP_WIDTH = 340;

/** Fixed-position spot under the anchor, or above it when the anchor sits low in the window. */
function spot(rect: DOMRect): Pos {
  const width = Math.min(POP_WIDTH, window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  return rect.bottom > window.innerHeight * 0.62
    ? { left, bottom: window.innerHeight - rect.top + 8 }
    : { left, top: rect.bottom + 8 };
}

/**
 * An essay with its sentence comments as highlights. Hovering, focusing or tapping a highlight shows the
 * comment in a pop-up. When `onChange` is given, the pop-up can edit or remove the comment, and selecting
 * any text in the essay offers "Add comment".
 */
export function EssayText({
  text,
  comments,
  taskType,
  onChange,
  className,
}: {
  text: string;
  comments: SentenceFeedback[];
  taskType: TaskType;
  onChange?: (next: SentenceFeedback[]) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const anchor = useRef<() => DOMRect>(() => new DOMRect());
  const [open, setOpen] = useState<Open | null>(null);
  const editable = Boolean(onChange);

  // Fixed position, so the pop-up is never clipped by a scrolling pane; it follows its anchor on scroll.
  const place = (rect: () => DOMRect) => {
    anchor.current = rect;
    return spot(rect());
  };
  const at = (el: HTMLElement) => place(() => el.getBoundingClientRect());

  const show = (index: number, el: HTMLElement) => {
    clearTimeout(closeTimer.current);
    if (open && open.kind !== "read") return; // never replace a form the teacher is typing in
    setOpen({ kind: "read", index, ...at(el) });
  };
  const hideSoon = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen((o) => (o?.kind === "read" ? null : o)), 180);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !(t instanceof Element && t.closest(`.${styles.mark}`))) setOpen(null);
    };
    const follow = () =>
      setOpen((o) => (o ? ({ ...o, top: undefined, bottom: undefined, ...spot(anchor.current()) } as Open) : o));
    document.addEventListener("pointerdown", onDown);
    addEventListener("scroll", follow, true);
    addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      removeEventListener("scroll", follow, true);
      removeEventListener("resize", follow);
    };
  }, [open]);

  const onSelect = () => {
    if (!editable) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !box.current) return;
    const range = sel.getRangeAt(0);
    if (!box.current.contains(range.commonAncestorContainer)) return;
    const picked = sel.toString().trim();
    if (picked.length < 3 || !text.includes(picked)) return;
    setOpen({ kind: "add", text: picked, ...place(() => range.getBoundingClientRect()) });
  };

  const save = (next: SentenceFeedback[]) => {
    onChange?.(next);
    setOpen(null);
    window.getSelection()?.removeAllRanges();
  };

  const onMarkKey = (e: KeyboardEvent<HTMLElement>, index: number) => {
    if (e.key === "Escape") return setOpen(null);
    if (editable && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen({ kind: "edit", index, ...at(e.currentTarget) });
    }
  };

  const parts = markPhrases(
    text,
    comments.map((c) => c.original),
  );

  return (
    <div className={`${styles.wrap} ${className ?? ""}`} ref={box}>
      <div className={styles.text} onMouseUp={onSelect} onKeyUp={(e) => e.shiftKey && onSelect()}>
        {parts.map((part, i) =>
          part.mark === null ? (
            <span key={i}>{part.text}</span>
          ) : (
            <mark
              key={i}
              className={styles.mark}
              data-active={open && "index" in open && open.index === part.mark ? "" : undefined}
              tabIndex={0}
              role={editable ? "button" : undefined}
              aria-describedby={open?.kind === "read" && open.index === part.mark ? "essay-pop" : undefined}
              onMouseEnter={(e) => show(part.mark!, e.currentTarget)}
              onMouseLeave={hideSoon}
              onFocus={(e) => show(part.mark!, e.currentTarget)}
              onBlur={hideSoon}
              onClick={(e) => {
                const pos = at(e.currentTarget);
                setOpen(editable ? { kind: "edit", index: part.mark!, ...pos } : { kind: "read", index: part.mark!, ...pos });
              }}
              onKeyDown={(e) => onMarkKey(e, part.mark!)}
            >
              {part.text}
            </mark>
          ),
        )}
      </div>

      {open && (
        <div
          ref={pop}
          id="essay-pop"
          role={open.kind === "read" ? "tooltip" : "dialog"}
          aria-label={open.kind === "read" ? undefined : "Sentence comment"}
          className={styles.pop}
          style={{ top: open.top, bottom: open.bottom, left: open.left, width: `min(${POP_WIDTH}px, calc(100vw - 16px))` }}
          onMouseEnter={() => clearTimeout(closeTimer.current)}
          onMouseLeave={open.kind === "read" ? hideSoon : undefined}
          onKeyDown={(e) => e.key === "Escape" && setOpen(null)}
        >
          {open.kind === "read" && comments[open.index] && (
            <Comment item={comments[open.index]!} taskType={taskType}>
              {editable && (
                <div className={styles.popActions}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen({ ...open, kind: "edit" })}>
                    <Icon name="edit_square" /> Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => save(comments.filter((_, j) => j !== open.index))}
                  >
                    <Icon name="close" /> Remove
                  </button>
                </div>
              )}
            </Comment>
          )}
          {open.kind === "add" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setOpen({ ...open, kind: "new" })}
            >
              <Icon name="add" /> Add comment
            </button>
          )}
          {(open.kind === "edit" || open.kind === "new") && (
            <CommentForm
              key={open.kind === "edit" ? `e${open.index}` : `n${open.text}`}
              initial={
                open.kind === "edit"
                  ? comments[open.index]!
                  : { original: open.text, category: "grammatical_range_accuracy", explanation: "", suggestion: "" }
              }
              taskType={taskType}
              onCancel={() => setOpen(null)}
              onRemove={open.kind === "edit" ? () => save(comments.filter((_, j) => j !== open.index)) : undefined}
              onSave={(item) =>
                save(open.kind === "edit" ? comments.map((c, j) => (j === open.index ? item : c)) : [...comments, item])
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function Comment({ item, taskType, children }: { item: SentenceFeedback; taskType: TaskType; children?: ReactNode }) {
  const cat = categoryLabel(item.category, taskType);
  return (
    <div className={styles.comment}>
      <span className="chip" title={cat.name}>
        {cat.short} · {cat.name}
      </span>
      {item.explanation && <p className={styles.why}>{item.explanation}</p>}
      {item.suggestion && (
        <p className={styles.fix}>
          <span className={styles.tryLabel}>Try →</span> {item.suggestion}
        </p>
      )}
      {children}
    </div>
  );
}

function CommentForm({
  initial,
  taskType,
  onSave,
  onCancel,
  onRemove,
}: {
  initial: SentenceFeedback;
  taskType: TaskType;
  onSave: (item: SentenceFeedback) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const [item, setItem] = useState(initial);
  const valid = item.explanation.trim() || item.suggestion.trim();
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ ...item, explanation: item.explanation.trim(), suggestion: item.suggestion.trim() });
      }}
    >
      <p className={styles.quote}>“{item.original}”</p>
      <label className="hint" htmlFor="pop-cat">
        Criterion
      </label>
      <select
        id="pop-cat"
        className="select"
        value={item.category}
        onChange={(e) => setItem({ ...item, category: e.target.value })}
      >
        {CRITERIA.map((c) => (
          <option key={c.key} value={c.key}>
            {criterionName(c, taskType).name}
          </option>
        ))}
      </select>
      <label className="hint" htmlFor="pop-why">
        What&apos;s wrong
      </label>
      <textarea
        id="pop-why"
        className="textarea"
        rows={2}
        autoFocus
        value={item.explanation}
        onChange={(e) => setItem({ ...item, explanation: e.target.value })}
      />
      <label className="hint" htmlFor="pop-fix">
        Better version
      </label>
      <textarea
        id="pop-fix"
        className="textarea"
        rows={2}
        value={item.suggestion}
        onChange={(e) => setItem({ ...item, suggestion: e.target.value })}
      />
      <div className={styles.popActions}>
        {onRemove && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove}>
            Remove
          </button>
        )}
        <span className={styles.spacer} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!valid}>
          Save
        </button>
      </div>
    </form>
  );
}
