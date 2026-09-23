import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import { AnalyticsService } from './analytics.service.js';

function makePrisma() {
  return { $queryRaw: vi.fn() } as unknown as PrismaService & {
    $queryRaw: ReturnType<typeof vi.fn>;
  };
}

function makeAudit() {
  return { logEvent: vi.fn() } as unknown as AuditService & {
    logEvent: ReturnType<typeof vi.fn>;
  };
}

describe('AnalyticsService.getOverview', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let audit: ReturnType<typeof makeAudit>;
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    service = new AnalyticsService(prisma, audit);
  });

  it('folds the two aggregate rows into one response', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          submissions_with_revision: 5,
          published_count: 3,
          rows_with_ai_baseline: 4,
          override_count: 3,
          override_rate: 0.75,
          mean_abs_delta_task_response: 0.5,
          mean_abs_delta_coherence_cohesion: 0.25,
          mean_abs_delta_lexical_resource: 0.5,
          mean_abs_delta_grammatical_range_accuracy: 0.25,
          mean_abs_delta_overall: 0.5,
          mean_queue_latency_seconds: 144,
          mean_scoring_latency_seconds: 3.7,
          mean_review_duration_seconds: 450,
          reason_tagged_rate: 0.4,
        },
      ])
      .mockResolvedValueOnce([
        { attempts: 5, completions: 4, failures: 1, retries: 1, failure_rate: 0.2 },
      ]);

    const result = await service.getOverview();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(result.totals.submissionsWithRevision).toBe(5);
    expect(result.totals.publishedCount).toBe(3);
    expect(result.agreement.rowsWithAiBaseline).toBe(4);
    expect(result.agreement.overrideRate).toBe(0.75);
    expect(result.agreement.meanAbsDelta.overall).toBe(0.5);
    expect(result.agreement.meanAbsDelta.grammatical_range_accuracy).toBe(0.25);
    expect(result.scoring.attempts).toBe(5);
    expect(result.scoring.failureRate).toBe(0.2);
    expect(result.process.meanReviewDurationSeconds).toBe(450);
  });

  it('returns an all-zero shape on an empty database rather than throwing', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await service.getOverview();

    expect(result.totals.submissionsWithRevision).toBe(0);
    expect(result.agreement.overrideRate).toBeNull();
    expect(result.scoring.attempts).toBe(0);
    expect(result.scoring.failureRate).toBeNull();
  });
});

describe('AnalyticsService.getScoringHealth', () => {
  it('passes the rows through with numbers, not Decimals', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, makeAudit());
    prisma.$queryRaw.mockResolvedValue([
      {
        day: '2026-09-15',
        model_name: 'gemini-2.5-flash',
        model_version: '2026-09-01',
        attempts: 5,
        completions: 4,
        failures: 1,
        retries: 1,
        mean_queue_latency_seconds: 144,
        p95_queue_latency_seconds: 180,
        mean_scoring_latency_seconds: 3.7,
        p95_scoring_latency_seconds: 6,
      },
    ]);

    const rows = await service.getScoringHealth({ from: '2026-09-01', to: '2026-09-30' });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      day: '2026-09-15',
      modelName: 'gemini-2.5-flash',
      modelVersion: '2026-09-01',
      attempts: 5,
      completions: 4,
      failures: 1,
      retries: 1,
      meanQueueLatencySeconds: 144,
      p95QueueLatencySeconds: 180,
      meanScoringLatencySeconds: 3.7,
      p95ScoringLatencySeconds: 6,
    });
  });
});
