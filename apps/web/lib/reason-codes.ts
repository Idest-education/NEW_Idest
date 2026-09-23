import { CRITERION_ABBR, type Criterion } from "./idest";

/**
 * Why a teacher changed the AI's score.
 *
 * These eight strings are the `RevisionReason` enum in the server's Prisma
 * schema. `POST /revision-reasons/batch` validates them with `@IsEnum`, so a
 * typo here is a rejected request, not a silent mislabel.
 */
export type RevisionReason =
  | "ai_too_generous"
  | "ai_too_harsh"
  | "ai_missed_off_topic"
  | "ai_wrong_criterion"
  | "ai_feedback_inaccurate"
  | "ai_unavailable"
  | "minor_polish"
  | "other";

/** Order shown in the modal: AI failure modes first, housekeeping last. */
export const REASON_CODES: RevisionReason[] = [
  "ai_too_generous",
  "ai_too_harsh",
  "ai_missed_off_topic",
  "ai_wrong_criterion",
  "ai_feedback_inaccurate",
  "ai_unavailable",
  "minor_polish",
  "other",
];

export const REASON_LABEL: Record<RevisionReason, string> = {
  ai_too_generous: "AI chấm quá rộng tay",
  ai_too_harsh: "AI chấm quá khắt khe",
  ai_missed_off_topic: "AI không nhận ra bài lạc đề",
  ai_wrong_criterion: "AI chấm nhầm tiêu chí",
  ai_feedback_inaccurate: "Nhận xét của AI không đúng",
  ai_unavailable: "AI không chấm được, giáo viên tự chấm",
  minor_polish: "Chỉ chỉnh sửa nhỏ",
  other: "Lý do khác",
};

/**
 * One entry of `score_revisions.changes.score_changes`.
 *
 * The server builds these by diffing two loosely typed score objects
 * (`assessments.service.ts:41-55`), so a criterion present on only one side
 * arrives with its counterpart `undefined` — and `JSON.stringify` drops the key
 * entirely. Both ends are therefore optional, whatever the older
 * `ScoreRevision.changes` type in `idest.ts` claims.
 */
export interface ScoreChange {
  criterion: string;
  from?: number | null;
  to?: number | null;
}

/** Printed when a revision touched only the feedback text. */
export const NO_SCORE_CHANGE = "Không đổi điểm, chỉ sửa nhận xét";

function changeLabel(criterion: string): string {
  if (criterion === "overall") return "Overall";
  const abbr: string | undefined = CRITERION_ABBR[criterion as Criterion];
  return abbr ?? criterion;
}

function figure(value: number | null | undefined): string {
  return typeof value === "number" && !Number.isNaN(value) ? value.toFixed(1) : "—";
}

/**
 * "TR 7.0 → 6.5", one line per criterion the teacher moved. An empty array
 * means the revision changed no score, which the caller renders as
 * `NO_SCORE_CHANGE` rather than as blank space.
 */
export function describeScoreChanges(changes: ScoreChange[] | undefined | null): string[] {
  if (!changes || changes.length === 0) return [];
  return changes.map(
    (change) => `${changeLabel(change.criterion)} ${figure(change.from)} → ${figure(change.to)}`,
  );
}

/** Adds or removes one value, leaving the rest of the selection alone. */
export function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

/**
 * A batch is only worth sending when at least one revision is still checked and
 * at least one reason is picked. An empty tag set would be indistinguishable
 * from "never asked", and the thesis must never conflate the two.
 */
export function canSubmitBatch(revisionIds: string[], reasonCodes: RevisionReason[]): boolean {
  return revisionIds.length > 0 && reasonCodes.length > 0;
}
