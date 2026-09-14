import { CRITERIA, type Criterion, type Scores } from "./idest";

/** Band figures are always printed to one decimal, or an em dash when absent. */
export function band(value: number | undefined | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

/** Position of a band on the 0–9 rule, as a percentage. */
export function bandOffset(value: number | undefined | null): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, (value / 9) * 100));
}

export function deviation(
  from: number | undefined | null,
  to: number | undefined | null,
): number | null {
  if (typeof from !== "number" || typeof to !== "number") return null;
  const diff = Number((to - from).toFixed(1));
  return diff === 0 ? 0 : diff;
}

export function signedBand(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "±0.0";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

export function criterionValues(
  scores: Scores | undefined,
): Array<{ criterion: Criterion; value: number | undefined }> {
  return CRITERIA.map((criterion) => ({
    criterion,
    value: typeof scores?.[criterion] === "number" ? scores[criterion] : undefined,
  }));
}

/** A valid IELTS band: 0–9 in steps of 0.5. Mirrors the server's own guard. */
export function isBand(value: number | undefined | null): value is number {
  if (typeof value !== "number" || Number.isNaN(value)) return false;
  if (value < 0 || value > 9) return false;
  return Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
}

/** IELTS overall is the mean of four criteria rounded to the nearest half band. */
export function overallFromCriteria(scores: Scores): number | undefined {
  const values = CRITERIA.map((c) => scores[c]).filter(isBand);
  if (values.length !== CRITERIA.length) return undefined;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  return Math.round(mean * 2) / 2;
}

const dateTime = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dateOnly = new Intl.DateTimeFormat("vi-VN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function stamp(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateTime.format(date);
}

export function day(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return dateOnly.format(date);
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** The ref printed on every strip: BB-<tail>/<attempt>. */
export function stripRef(id: string | undefined, attempt?: number): string {
  if (!id) return "BB-——————";
  const tail = id.replace(/-/g, "").slice(-6).toUpperCase();
  return attempt ? `BB-${tail}/${attempt}` : `BB-${tail}`;
}

export function splitParagraphs(essay: string): string[] {
  return essay
    .split(/\r?\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
