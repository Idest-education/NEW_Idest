"use client";

export { PAGE_SIZE, pageOf } from "../lib/format";

/** Newer / Older buttons with "Page x of y". Renders nothing for a single page. */
export function Pager({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="row" aria-label="Pages" style={{ justifyContent: "center" }}>
      <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Newer
      </button>
      <span className="hint num" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Older
      </button>
    </nav>
  );
}
