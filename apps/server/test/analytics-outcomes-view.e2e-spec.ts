import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  at,
  resetAnalyticsDatabase,
  seedAnalyticsFixtures,
  type FixtureIds,
} from './analytics-fixtures.js';

const prisma = new PrismaClient();
let ids: FixtureIds;

/** Prisma returns PostgreSQL `numeric` as a Decimal object. */
function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

interface OutcomeRow {
  submission_id: string;
  assignment_id: string;
  class_id: string | null;
  student_id: string;
  teacher_id: string;
  revision_id: string;
  revision_number: number;
  revision_count: number;
  publish_count: number;
  is_published: boolean;
  has_ai_baseline: boolean;
  is_override: boolean | null;
  ai_task_response: unknown;
  ai_overall: unknown;
  teacher_task_response: unknown;
  teacher_overall: unknown;
  delta_overall: unknown;
  abs_delta_overall: unknown;
  model_name: string | null;
  model_version: string | null;
  reason_codes: string[] | null;
  reason_source: string | null;
  tag_latency_seconds: unknown;
  queued_at: Date | null;
  scoring_completed_at: Date | null;
  review_opened_at: Date | null;
  revision_created_at: Date;
  published_at: Date | null;
  queue_latency_seconds: unknown;
  scoring_latency_seconds: unknown;
  review_duration_seconds: unknown;
  elapsed_ms: number | null;
  total_tokens: number | null;
  word_count: number;
  essay_text: string;
}

async function rowFor(submissionId: string): Promise<OutcomeRow> {
  const rows = await prisma.$queryRaw<OutcomeRow[]>`
    SELECT * FROM v_assessment_outcomes WHERE submission_id = ${submissionId}::uuid
  `;
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

afterAll(async () => {
  // Leave nothing behind: these fixtures create classes, and the older specs
  // in this suite do not delete them, so their user.deleteMany would hit
  // classes_teacher_id_fkey.
  await resetAnalyticsDatabase(prisma);
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetAnalyticsDatabase(prisma);
  ids = await seedAnalyticsFixtures(prisma);
});

describe('v_assessment_outcomes', () => {
  it('emits exactly one row per submission that has a revision', async () => {
    const rows = await prisma.$queryRaw<{ submission_id: string }[]>`
      SELECT submission_id FROM v_assessment_outcomes ORDER BY submission_id
    `;
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.submission_id)).size).toBe(5);
  });

  it('A: a republished submission counts both publications but yields one row', async () => {
    const row = await rowFor(ids.subA);
    expect(row.revision_id).toBe(ids.revA1);
    expect(row.revision_count).toBe(1);
    expect(row.publish_count).toBe(2);
    expect(row.is_published).toBe(true);
    expect(row.published_at).toEqual(at(35));
    expect(row.assignment_id).toBe(ids.assignmentId);
    expect(row.class_id).toBe(ids.classId);
    expect(row.student_id).toBe(ids.studentId);
    expect(row.teacher_id).toBe(ids.teacherId);
    expect(row.word_count).toBe(250);
  });

  it('A: carries the AI baseline, the deltas and the model provenance', async () => {
    const row = await rowFor(ids.subA);
    expect(row.has_ai_baseline).toBe(true);
    expect(num(row.ai_overall)).toBe(6.0);
    expect(num(row.teacher_overall)).toBe(6.5);
    expect(num(row.ai_task_response)).toBe(6.0);
    expect(num(row.teacher_task_response)).toBe(6.5);
    expect(num(row.delta_overall)).toBe(0.5);
    expect(num(row.abs_delta_overall)).toBe(0.5);
    expect(row.is_override).toBe(true);
    expect(row.model_name).toBe('gemini-2.5-flash');
    expect(row.model_version).toBe('2026-09-01');
  });

  it('A: derives queue, scoring and review timings, and carries token cost', async () => {
    const row = await rowFor(ids.subA);
    expect(row.queued_at).toEqual(at(1));
    expect(row.scoring_completed_at).toEqual(at(3));
    expect(row.review_opened_at).toEqual(at(10));
    expect(row.revision_created_at).toEqual(at(20));
    expect(num(row.queue_latency_seconds)).toBe(120);
    expect(num(row.scoring_latency_seconds)).toBe(4);
    expect(num(row.review_duration_seconds)).toBe(600);
    expect(row.elapsed_ms).toBe(4000);
    expect(row.total_tokens).toBe(1200);
  });

  it('A: reports the most recent reason tag, not the first one', async () => {
    const row = await rowFor(ids.subA);
    expect(row.reason_codes).toEqual(['ai_too_generous', 'minor_polish']);
    expect(row.reason_source).toBe('batch');
    expect(num(row.tag_latency_seconds)).toBe(2400);
  });

  it('B: ground truth is the published revision, never max(revision_number)', async () => {
    const row = await rowFor(ids.subB);
    expect(row.revision_id).toBe(ids.revB2);
    expect(row.revision_number).toBe(2);
    expect(num(row.teacher_overall)).toBe(6.0);
    expect(num(row.ai_overall)).toBe(5.0);
    expect(num(row.delta_overall)).toBe(1.0);
    expect(row.revision_count).toBe(3);
    expect(row.publish_count).toBe(2);
    expect(row.is_published).toBe(true);
    expect(row.published_at).toEqual(at(45));
  });

  it('C: a teacher-first revision has no AI baseline and no deltas', async () => {
    const row = await rowFor(ids.subC);
    expect(row.revision_id).toBe(ids.revC1);
    expect(row.has_ai_baseline).toBe(false);
    expect(row.ai_overall).toBeNull();
    expect(row.ai_task_response).toBeNull();
    expect(row.delta_overall).toBeNull();
    expect(row.abs_delta_overall).toBeNull();
    expect(row.is_override).toBeNull();
    expect(row.model_name).toBeNull();
    expect(row.model_version).toBeNull();
    expect(row.scoring_completed_at).toBeNull();
    expect(row.queued_at).toBeNull();
    expect(row.queue_latency_seconds).toBeNull();
    expect(num(row.teacher_overall)).toBe(7.0);
    expect(row.is_published).toBe(false);
    expect(row.publish_count).toBe(0);
  });

  it('D: with no live publication the latest revision is used and is_published is false', async () => {
    const row = await rowFor(ids.subD);
    expect(row.revision_id).toBe(ids.revD2);
    expect(row.revision_number).toBe(2);
    expect(row.revision_count).toBe(2);
    expect(row.is_published).toBe(false);
    expect(row.published_at).toBeNull();
    expect(row.publish_count).toBe(1);
    expect(num(row.teacher_overall)).toBe(7.0);
    expect(row.is_override).toBe(true);
  });

  it('E: a retry re-dates the queue, and cost comes from the successful attempt', async () => {
    const row = await rowFor(ids.subE);
    expect(row.queued_at).toEqual(at(10));
    expect(row.scoring_completed_at).toEqual(at(13));
    expect(num(row.queue_latency_seconds)).toBe(180);
    expect(num(row.scoring_latency_seconds)).toBe(5);
    expect(row.elapsed_ms).toBe(5000);
    expect(row.total_tokens).toBe(1400);
    expect(num(row.ai_overall)).toBe(6.5);
    expect(num(row.teacher_overall)).toBe(7.0);
    expect(num(row.delta_overall)).toBe(0.5);
    expect(num(row.review_duration_seconds)).toBe(300);
  });

  it('never exposes student identity', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'v_assessment_outcomes'
    `;
    const names = columns.map((c) => c.column_name);
    expect(names).not.toContain('email');
    expect(names).not.toContain('display_name');
  });
});
