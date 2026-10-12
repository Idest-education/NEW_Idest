import type { CriterionKey, Scores, SubmissionStatus, TaskType } from "./api";

export const band = (n: number | null | undefined) => (typeof n === "number" ? n.toFixed(1) : "—");

export const countWords = (text: string) => {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
};

export const taskLabel = (t: TaskType) => (t === "task_1" ? "Task 1" : "Task 2");

/** IELTS overall: mean of the four criteria, rounded to the nearest half band (.25 and .75 round up). */
export function overallFrom(scores: Record<CriterionKey, number>): number {
  const { task_response, coherence_cohesion, lexical_resource, grammatical_range_accuracy } = scores;
  const mean = (task_response + coherence_cohesion + lexical_resource + grammatical_range_accuracy) / 4;
  return Math.round(mean * 2) / 2;
}

export const withOverall = (s: Record<CriterionKey, number>): Scores => ({ ...s, overall: overallFrom(s) });

export const STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: "Not sent yet",
  queued: "Queued",
  scoring: "Scoring",
  scored: "AI draft",
  under_review: "Draft saved",
  published: "Finalized",
  failed: "Failed",
  abuse: "Flagged",
};

export const isWorking = (s: SubmissionStatus) => s === "queued" || s === "scoring";

export function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type DateGroup = "Today" | "Yesterday" | "Previous 7 days" | "Earlier";

/** Groups items by calendar day relative to `now`, keeping the input order inside each group. */
export function groupByDate<T>(items: T[], dateOf: (item: T) => string, now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const groups = new Map<DateGroup, T[]>();
  for (const item of items) {
    const t = new Date(dateOf(item)).getTime();
    const group: DateGroup =
      t >= startOfToday
        ? "Today"
        : t >= startOfToday - day
          ? "Yesterday"
          : t >= startOfToday - 7 * day
            ? "Previous 7 days"
            : "Earlier";
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return [...groups.entries()].map(([label, list]) => ({ label, items: list }));
}

/** Splits an essay into plain and marked parts, marking the first unused match of each phrase. */
export function markPhrases(text: string, phrases: string[]): { text: string; mark: number | null }[] {
  const hits: { start: number; end: number; index: number }[] = [];
  phrases.forEach((phrase, index) => {
    const p = phrase.trim();
    if (!p) return;
    let from = 0;
    for (;;) {
      const start = text.indexOf(p, from);
      if (start < 0) return;
      const end = start + p.length;
      if (!hits.some((h) => start < h.end && end > h.start)) {
        hits.push({ start, end, index });
        return;
      }
      from = start + 1;
    }
  });
  hits.sort((a, b) => a.start - b.start);
  const parts: { text: string; mark: number | null }[] = [];
  let cursor = 0;
  for (const h of hits) {
    if (h.start > cursor) parts.push({ text: text.slice(cursor, h.start), mark: null });
    parts.push({ text: text.slice(h.start, h.end), mark: h.index });
    cursor = h.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), mark: null });
  return parts;
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type Tone = "low" | "mid" | "good" | "great";

/** Color family for a band: up to 5, 5.5–6, 6.5–7, then 7.5 and above. */
export const bandTone = (n: number): Tone => (n <= 5 ? "low" : n <= 6 ? "mid" : n <= 7 ? "good" : "great");

const BAND_WORDS = ["Did not attempt", "Non-user", "Intermittent user", "Extremely limited", "Limited user", "Modest user", "Competent user", "Good user", "Very good user", "Expert user"];

/** The IELTS descriptor for the whole band a score falls in (6.5 is still "Competent user"). */
export const bandWord = (n: number) => BAND_WORDS[Math.max(0, Math.min(9, Math.floor(n)))]!;

export const PAGE_SIZE = 15;

/** One page of an in-memory list, with the page clamped into range. */
export function pageOf<T>(items: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  return { items: items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), page: current, totalPages };
}
