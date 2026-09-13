const common = {
  fill: "none",
  strokeWidth: 2.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** 01 — a page leaving the student's hand, off to the queue. */
function SubmitArt() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" stroke="currentColor" {...common}>
      <path d="M16 10h22l8 8v34a2 2 0 0 1-2 2H16a2 2 0 0 1-2-2V12a2 2 0 0 1 2-2Z" />
      <path d="M38 10v8h8" />
      <line x1="20" y1="30" x2="34" y2="30" opacity="0.55" />
      <line x1="20" y1="37" x2="34" y2="37" opacity="0.55" />
      <path d="M46 40h12M52 34l6 6-6 6" />
    </svg>
  );
}

/** 02 — the machine reading the page and printing a first, quick mark. */
function DraftArt() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" stroke="currentColor" {...common}>
      <rect x="12" y="12" width="34" height="40" rx="2" />
      <line x1="18" y1="22" x2="40" y2="22" opacity="0.55" />
      <line x1="18" y1="29" x2="40" y2="29" opacity="0.55" />
      <line x1="18" y1="36" x2="32" y2="36" opacity="0.55" />
      <path d="M48 14l2.4 5.1 5.1 2.4-5.1 2.4L48 29l-2.4-5.1-5.1-2.4 5.1-2.4Z" />
      <path d="M50 40l1.4 3 3 1.4-3 1.4-1.4 3-1.4-3-3-1.4 3-1.4Z" opacity="0.7" />
    </svg>
  );
}

/** 03 — the teacher's own line written over the machine's, which stays legible beneath. */
function OverwriteArt() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" stroke="currentColor" {...common}>
      <rect x="12" y="10" width="36" height="44" rx="2" />
      <g opacity="0.5">
        <line x1="18" y1="22" x2="38" y2="22" />
        <line x1="18" y1="20.5" x2="38" y2="23.5" />
      </g>
      <path d="M16 32c6-3 16-3 24 0" strokeWidth="3.25" />
      <path d="M40 40 52 28l4 4-12 12h-4v-4Z" />
    </svg>
  );
}

/** 04 — the sheet stamped and seated, ready for the student to read. */
function ApproveArt() {
  return (
    <svg viewBox="0 0 64 64" width="100%" height="100%" stroke="currentColor" {...common}>
      <circle cx="30" cy="28" r="16" />
      <path d="M22 28l5.5 5.5L39 22" />
      <path d="M23 43l-4 11 11-5 11 5-4-11" opacity="0.7" />
    </svg>
  );
}

export const STEP_ART = [SubmitArt, DraftArt, OverwriteArt, ApproveArt];
