import {
  itemsFor,
  type AnswerError,
  type AnswerErrorReason,
  type Answers,
  type SurveyRole,
} from "@repo/feedback-contract";
import type { FeedbackState } from "./idest";

export interface FeedbackDraft {
  savedAt: string;
  answers: Answers;
}

/**
 * Pages the teacher pop-up must never cover: the survey itself and an open
 * review, where a modal would interrupt grading.
 */
export function promptAllowedOn(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/feedback" || pathname.startsWith("/feedback/")) return false;
  return !/^\/teacher\/submissions\/[^/]+/.test(pathname);
}

/** The dashboard banner asks until the user has submitted; nothing while loading or on error. */
export function bannerVisible(state: FeedbackState | null): boolean {
  return state !== null && state.response === null;
}

export function draftKey(version: number, userId: string): string {
  return `idest.feedback.draft.v${version}.${userId}`;
}

export function parseDraft(raw: string | null): FeedbackDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { savedAt, answers } = value as { savedAt?: unknown; answers?: unknown };
  if (typeof savedAt !== "string" || Number.isNaN(Date.parse(savedAt))) return null;
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) return null;
  const clean: Answers = {};
  for (const [code, answer] of Object.entries(answers)) {
    if (typeof answer === "number" || typeof answer === "string") clean[code] = answer;
  }
  return { savedAt, answers: clean };
}

export function readDraft(key: string): FeedbackDraft | null {
  try {
    return parseDraft(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeDraft(key: string, answers: Answers, now = new Date()): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ savedAt: now.toISOString(), answers }));
  } catch {
    /* private mode: the form still works, the draft is just not kept */
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear */
  }
}

/** Keeps only codes this role is asked, so a stale draft can never block submit. */
export function forRole(role: SurveyRole, answers: Answers): Answers {
  const out: Answers = {};
  for (const item of itemsFor(role)) {
    const answer = answers[item.code];
    if (answer !== undefined) out[item.code] = answer;
  }
  return out;
}

/** The newer of the saved response and the local draft wins. */
export function initialAnswers(
  role: SurveyRole,
  response: { answers: Answers; updatedAt: string } | null,
  draft: FeedbackDraft | null,
): { answers: Answers; fromDraft: boolean } {
  if (draft && (response === null || Date.parse(draft.savedAt) > Date.parse(response.updatedAt))) {
    return { answers: forRole(role, draft.answers), fromDraft: true };
  }
  return { answers: forRole(role, response?.answers ?? {}), fromDraft: false };
}

/** Required items answered, for the progress bar. Whitespace-only text does not count. */
export function progress(role: SurveyRole, answers: Answers): { answered: number; total: number } {
  const required = itemsFor(role).filter((item) => item.required);
  const answered = required.filter((item) => {
    const answer = answers[item.code];
    return typeof answer === "number" || (typeof answer === "string" && answer.trim() !== "");
  }).length;
  return { answered, total: required.length };
}

/** The item the page scrolls to: the first failing one in questionnaire order. */
export function firstErrorCode(role: SurveyRole, errors: readonly AnswerError[]): string | null {
  const failing = new Set(errors.map((error) => error.code));
  return itemsFor(role).find((item) => failing.has(item.code))?.code ?? null;
}

const ERROR_TEXT: Record<AnswerErrorReason, string> = {
  required: "Chưa trả lời",
  too_long: "Quá 2000 ký tự",
  type: "Giá trị không hợp lệ",
  range: "Giá trị không hợp lệ",
  unknown: "Câu hỏi không còn trong bảng hỏi",
  not_for_role: "Câu hỏi không dành cho vai trò của bạn",
};

export function errorText(reason: AnswerErrorReason): string {
  return ERROR_TEXT[reason];
}

/** Matches the server's names, so the .sps finds the CSV downloaded the same UTC day. */
export function exportFilename(format: "csv" | "sps", now = new Date()): string {
  return `feedback-${now.toISOString().slice(0, 10)}.${format}`;
}
