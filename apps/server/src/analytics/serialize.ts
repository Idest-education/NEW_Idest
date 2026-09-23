/**
 * The export column list. A module constant, never caller input — it is
 * interpolated into SQL with Prisma.raw, so nothing here may come from a
 * request.
 *
 * The export is pseudonymous: it carries student_id and nothing else that
 * identifies the student. No email, no display name. CLAUDE.md rule 4.
 */
export const EXPORT_COLUMNS = [
  'submission_id',
  'assignment_id',
  'class_id',
  'student_id',
  'teacher_id',
  'task_type',
  'attempt_number',
  'word_count',
  'submitted_at',
  'revision_id',
  'revision_number',
  'revision_count',
  'ai_task_response',
  'ai_coherence_cohesion',
  'ai_lexical_resource',
  'ai_grammatical_range_accuracy',
  'ai_overall',
  'teacher_task_response',
  'teacher_coherence_cohesion',
  'teacher_lexical_resource',
  'teacher_grammatical_range_accuracy',
  'teacher_overall',
  'delta_task_response',
  'delta_coherence_cohesion',
  'delta_lexical_resource',
  'delta_grammatical_range_accuracy',
  'delta_overall',
  'abs_delta_task_response',
  'abs_delta_coherence_cohesion',
  'abs_delta_lexical_resource',
  'abs_delta_grammatical_range_accuracy',
  'abs_delta_overall',
  'has_ai_baseline',
  'is_override',
  'reason_codes',
  'reason_source',
  'tag_latency_seconds',
  'model_name',
  'model_version',
  'queued_at',
  'scoring_completed_at',
  'review_opened_at',
  'revision_created_at',
  'published_at',
  'queue_latency_seconds',
  'scoring_latency_seconds',
  'review_duration_seconds',
  'elapsed_ms',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'is_published',
  'publish_count',
] as const;

export const ESSAY_COLUMN = 'essay_text';

export function columnsFor(includeEssays: boolean): string[] {
  return includeEssays ? [...EXPORT_COLUMNS, ESSAY_COLUMN] : [...EXPORT_COLUMNS];
}

/**
 * Flattens one value from a `$queryRaw` row into something JSON and CSV can
 * carry. PostgreSQL `numeric` arrives as a Prisma Decimal, `bigint` as a JS
 * bigint, `timestamptz` as a Date, and an enum array as a string array.
 */
export function toPlain(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) return value.map((item) => String(item)).join('|');
  if (
    typeof value === 'object' &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return value as string | number | boolean;
}

function csvCell(value: unknown): string {
  const plain = toPlain(value);
  if (plain === null) return '';
  const text = String(plain);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvHeader(columns: string[]): string {
  return `${columns.map((c) => csvCell(c)).join(',')}\n`;
}

export function csvRow(columns: string[], row: Record<string, unknown>): string {
  return `${columns.map((c) => csvCell(row[c])).join(',')}\n`;
}

export function jsonlRow(columns: string[], row: Record<string, unknown>): string {
  const out: Record<string, string | number | boolean | null> = {};
  for (const column of columns) {
    out[column] = toPlain(row[column]);
  }
  return `${JSON.stringify(out)}\n`;
}
