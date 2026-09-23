import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  resetAnalyticsDatabase,
  seedAnalyticsFixtures,
  type FixtureIds,
} from './analytics-fixtures.js';

const prisma = new PrismaClient();
let ids: FixtureIds;

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

afterAll(async () => {
  // These fixtures create classes; leave the database empty for the next file.
  await resetAnalyticsDatabase(prisma);
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetAnalyticsDatabase(prisma);
  ids = await seedAnalyticsFixtures(prisma);
});

interface HealthRow {
  day: Date;
  model_name: string;
  model_version: string;
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  mean_queue_latency_seconds: unknown;
  p95_queue_latency_seconds: unknown;
  mean_scoring_latency_seconds: unknown;
  p95_scoring_latency_seconds: unknown;
}

describe('v_scoring_health', () => {
  it('buckets every AI attempt into one day and model version', async () => {
    const rows = await prisma.$queryRaw<HealthRow[]>`
      SELECT * FROM v_scoring_health ORDER BY day, model_name, model_version
    `;
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.model_name).toBe('gemini-2.5-flash');
    expect(row.model_version).toBe('2026-09-01');
    expect(row.attempts).toBe(5);
    expect(row.completions).toBe(4);
    expect(row.failures).toBe(1);
  });

  it('counts an attempt as a retry when a retry_queued event preceded it', async () => {
    const [row] = await prisma.$queryRaw<HealthRow[]>`SELECT * FROM v_scoring_health`;
    // The failed attempt followed submission.queued; only the second attempt
    // on submission E followed submission.retry_queued.
    expect(row!.retries).toBe(1);
  });

  it('averages queue and scoring latency across all attempts', async () => {
    const [row] = await prisma.$queryRaw<HealthRow[]>`SELECT * FROM v_scoring_health`;
    // Queue: 120, 120, 120 (A, B, D) plus 180 (E failed) and 180 (E retry).
    expect(num(row!.mean_queue_latency_seconds)).toBeCloseTo(144, 6);
    expect(num(row!.p95_queue_latency_seconds)).toBeCloseTo(180, 6);
    // Scoring: 4, 6, 2, 1.5, 5 seconds.
    expect(num(row!.mean_scoring_latency_seconds)).toBeCloseTo(3.7, 6);
  });

  it('ignores teacher-authored scoring results', async () => {
    await prisma.scoringResult.create({
      data: {
        submissionId: ids.subC,
        scorerId: ids.teacherId,
        scorerType: 'teacher',
        status: 'completed',
        scores: { overall: 7.0 },
        feedback: {},
      },
    });
    const rows = await prisma.$queryRaw<HealthRow[]>`SELECT * FROM v_scoring_health`;
    expect(rows[0]!.attempts).toBe(5);
  });
});

interface ActivityRow {
  teacher_id: string;
  display_name: string;
  revision_count: number;
  revisions_with_ai_baseline: number;
  publish_count: number;
  unpublish_count: number;
  override_rate: unknown;
  mean_abs_delta_overall: unknown;
  mean_review_duration_seconds: unknown;
  reason_tagged_rate: unknown;
}

describe('v_teacher_activity', () => {
  it('counts every revision the teacher wrote, not only the published ones', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    expect(row!.display_name).toBe('Fixture Teacher');
    expect(row!.revision_count).toBe(8);
    expect(row!.revisions_with_ai_baseline).toBe(7);
  });

  it('counts publications and unpublications separately', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    expect(row!.publish_count).toBe(6);
    expect(row!.unpublish_count).toBe(3);
  });

  it('measures override rate only over revisions that had an AI baseline', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    // Six of the seven baselined revisions changed a score; revD1 agreed.
    expect(num(row!.override_rate)).toBeCloseTo(6 / 7, 6);
    // |0.5| + |0.5| + |1.0| + |3.0| + |0| + |1.0| + |0.5| over 7 rows.
    expect(num(row!.mean_abs_delta_overall)).toBeCloseTo(6.5 / 7, 6);
  });

  it('averages review duration over the revisions that have a review_opened event', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    expect(num(row!.mean_review_duration_seconds)).toBeCloseTo(450, 6);
  });

  it('reports the share of revisions carrying a reason tag', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.teacherId}::uuid
    `;
    expect(num(row!.reason_tagged_rate)).toBeCloseTo(2 / 8, 6);
  });

  it('lists an admin with no revisions as zeroes rather than omitting them', async () => {
    const [row] = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.adminId}::uuid
    `;
    expect(row!.revision_count).toBe(0);
    expect(row!.publish_count).toBe(0);
    expect(row!.override_rate).toBeNull();
  });

  it('never lists a student', async () => {
    const rows = await prisma.$queryRaw<ActivityRow[]>`
      SELECT * FROM v_teacher_activity WHERE teacher_id = ${ids.studentId}::uuid
    `;
    expect(rows).toHaveLength(0);
  });
});
