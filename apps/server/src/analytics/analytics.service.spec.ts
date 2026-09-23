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

describe('AnalyticsService.beginExport', () => {
  it('records an analytics.exported audit event before a byte is written', async () => {
    const prisma = makePrisma();
    const audit = makeAudit();
    const service = new AnalyticsService(prisma, audit);

    const exportId = await service.beginExport('admin-1', {
      format: 'csv',
      from: '2026-09-01',
      to: '2026-09-30',
      includeEssays: true,
    });

    expect(exportId).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.logEvent).toHaveBeenCalledWith({
      actorId: 'admin-1',
      eventType: 'analytics.exported',
      entityType: 'analytics_export',
      entityId: exportId,
      metadata: {
        from: '2026-09-01',
        to: '2026-09-30',
        format: 'csv',
        includeEssays: true,
      },
    });
  });

  it('records a null window and includeEssays false when nothing was asked for', async () => {
    const audit = makeAudit();
    const service = new AnalyticsService(makePrisma(), audit);

    await service.beginExport('admin-1', { format: 'jsonl', includeEssays: false });

    expect(audit.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { from: null, to: null, format: 'jsonl', includeEssays: false },
      }),
    );
  });
});

describe('AnalyticsService.streamExport', () => {
  it('emits a CSV header then one line per row', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, makeAudit());
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        submission_id: 'sub-1',
        revision_created_at: new Date('2026-09-15T08:20:00.000Z'),
        ai_overall: 6,
        teacher_overall: 6.5,
      },
    ]);

    const chunks: string[] = [];
    for await (const chunk of service.streamExport({ format: 'csv', includeEssays: false })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toContain('submission_id,assignment_id');
    expect(chunks[0]).not.toContain('essay_text');
    expect(chunks[1]).toContain('sub-1');
    expect(chunks).toHaveLength(2);
  });

  it('emits no header for JSONL', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, makeAudit());
    prisma.$queryRaw.mockResolvedValueOnce([
      { submission_id: 'sub-1', revision_created_at: new Date('2026-09-15T08:20:00.000Z') },
    ]);

    const chunks: string[] = [];
    for await (const chunk of service.streamExport({ format: 'jsonl', includeEssays: false })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(JSON.parse(chunks[0]!) as { submission_id: string }).toMatchObject({
      submission_id: 'sub-1',
    });
  });

  it('keeps paging while a page comes back full, then stops', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, makeAudit());
    const fullPage = Array.from({ length: 500 }, (_unused, i) => ({
      submission_id: `sub-${i}`,
      revision_created_at: new Date('2026-09-15T08:20:00.000Z'),
    }));
    prisma.$queryRaw
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([
        { submission_id: 'sub-last', revision_created_at: new Date('2026-09-15T08:21:00.000Z') },
      ]);

    let lines = 0;
    for await (const _chunk of service.streamExport({ format: 'jsonl', includeEssays: false })) {
      lines += 1;
    }

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(lines).toBe(501);
  });
});
