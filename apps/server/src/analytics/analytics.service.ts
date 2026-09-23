import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

export interface DateWindow {
  from?: string;
  to?: string;
}

export interface AnalyticsOverview {
  totals: {
    submissionsWithRevision: number;
    publishedCount: number;
  };
  agreement: {
    rowsWithAiBaseline: number;
    overrideCount: number;
    overrideRate: number | null;
    meanAbsDelta: {
      task_response: number | null;
      coherence_cohesion: number | null;
      lexical_resource: number | null;
      grammatical_range_accuracy: number | null;
      overall: number | null;
    };
  };
  scoring: {
    attempts: number;
    completions: number;
    failures: number;
    retries: number;
    failureRate: number | null;
    meanQueueLatencySeconds: number | null;
    meanScoringLatencySeconds: number | null;
  };
  process: {
    meanReviewDurationSeconds: number | null;
    reasonTaggedRate: number | null;
  };
}

export interface ScoringHealthRow {
  day: string;
  modelName: string;
  modelVersion: string;
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  meanQueueLatencySeconds: number | null;
  p95QueueLatencySeconds: number | null;
  meanScoringLatencySeconds: number | null;
  p95ScoringLatencySeconds: number | null;
}

interface OutcomeAggregate {
  submissions_with_revision: number;
  published_count: number;
  rows_with_ai_baseline: number;
  override_count: number;
  override_rate: number | null;
  mean_abs_delta_task_response: number | null;
  mean_abs_delta_coherence_cohesion: number | null;
  mean_abs_delta_lexical_resource: number | null;
  mean_abs_delta_grammatical_range_accuracy: number | null;
  mean_abs_delta_overall: number | null;
  mean_queue_latency_seconds: number | null;
  mean_scoring_latency_seconds: number | null;
  mean_review_duration_seconds: number | null;
  reason_tagged_rate: number | null;
}

interface HealthAggregate {
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  failure_rate: number | null;
}

interface HealthSeriesRow {
  day: string;
  model_name: string;
  model_version: string;
  attempts: number;
  completions: number;
  failures: number;
  retries: number;
  mean_queue_latency_seconds: number | null;
  p95_queue_latency_seconds: number | null;
  mean_scoring_latency_seconds: number | null;
  p95_scoring_latency_seconds: number | null;
}

/**
 * Reads the three analytics views. Every numeric aggregate is cast to float8 in
 * SQL, because Prisma maps PostgreSQL `numeric` to a Decimal object that would
 * serialize as a string over JSON.
 *
 * The only write on this path is the export audit row in
 * `beginExport` — the views themselves cannot corrupt grading data.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOverview(): Promise<AnalyticsOverview> {
    // avg() skips NULLs, and every ai_*/delta_* column is NULL exactly when
    // has_ai_baseline is false, so the agreement figures exclude those rows
    // without a filter. is_override is NULL there too, so the FILTER below
    // does not count them as agreements.
    const outcomes = await this.prisma.$queryRaw<OutcomeAggregate[]>(Prisma.sql`
      SELECT
        count(*)::int                                     AS submissions_with_revision,
        count(*) FILTER (WHERE is_published)::int         AS published_count,
        count(*) FILTER (WHERE has_ai_baseline)::int      AS rows_with_ai_baseline,
        count(*) FILTER (WHERE is_override)::int          AS override_count,
        (count(*) FILTER (WHERE is_override))::float8
          / NULLIF(count(*) FILTER (WHERE has_ai_baseline), 0)::float8 AS override_rate,
        avg(abs_delta_task_response)::float8              AS mean_abs_delta_task_response,
        avg(abs_delta_coherence_cohesion)::float8         AS mean_abs_delta_coherence_cohesion,
        avg(abs_delta_lexical_resource)::float8           AS mean_abs_delta_lexical_resource,
        avg(abs_delta_grammatical_range_accuracy)::float8 AS mean_abs_delta_grammatical_range_accuracy,
        avg(abs_delta_overall)::float8                    AS mean_abs_delta_overall,
        avg(queue_latency_seconds)::float8                AS mean_queue_latency_seconds,
        avg(scoring_latency_seconds)::float8              AS mean_scoring_latency_seconds,
        avg(review_duration_seconds)::float8              AS mean_review_duration_seconds,
        (count(*) FILTER (WHERE reason_codes IS NOT NULL))::float8
          / NULLIF(count(*), 0)::float8                   AS reason_tagged_rate
      FROM v_assessment_outcomes
    `);

    const health = await this.prisma.$queryRaw<HealthAggregate[]>(Prisma.sql`
      SELECT
        COALESCE(sum(attempts), 0)::int    AS attempts,
        COALESCE(sum(completions), 0)::int AS completions,
        COALESCE(sum(failures), 0)::int    AS failures,
        COALESCE(sum(retries), 0)::int     AS retries,
        COALESCE(sum(failures), 0)::float8
          / NULLIF(sum(attempts), 0)::float8 AS failure_rate
      FROM v_scoring_health
    `);

    const o = outcomes[0];
    const h = health[0];

    return {
      totals: {
        submissionsWithRevision: o?.submissions_with_revision ?? 0,
        publishedCount: o?.published_count ?? 0,
      },
      agreement: {
        rowsWithAiBaseline: o?.rows_with_ai_baseline ?? 0,
        overrideCount: o?.override_count ?? 0,
        overrideRate: o?.override_rate ?? null,
        meanAbsDelta: {
          task_response: o?.mean_abs_delta_task_response ?? null,
          coherence_cohesion: o?.mean_abs_delta_coherence_cohesion ?? null,
          lexical_resource: o?.mean_abs_delta_lexical_resource ?? null,
          grammatical_range_accuracy: o?.mean_abs_delta_grammatical_range_accuracy ?? null,
          overall: o?.mean_abs_delta_overall ?? null,
        },
      },
      scoring: {
        attempts: h?.attempts ?? 0,
        completions: h?.completions ?? 0,
        failures: h?.failures ?? 0,
        retries: h?.retries ?? 0,
        failureRate: h?.failure_rate ?? null,
        meanQueueLatencySeconds: o?.mean_queue_latency_seconds ?? null,
        meanScoringLatencySeconds: o?.mean_scoring_latency_seconds ?? null,
      },
      process: {
        meanReviewDurationSeconds: o?.mean_review_duration_seconds ?? null,
        reasonTaggedRate: o?.reason_tagged_rate ?? null,
      },
    };
  }

  async getScoringHealth(window: DateWindow): Promise<ScoringHealthRow[]> {
    const conditions: Prisma.Sql[] = [];
    if (window.from) conditions.push(Prisma.sql`day >= ${window.from}::date`);
    if (window.to) conditions.push(Prisma.sql`day <= ${window.to}::date`);
    const where =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const rows = await this.prisma.$queryRaw<HealthSeriesRow[]>(Prisma.sql`
      SELECT
        to_char(day, 'YYYY-MM-DD')                   AS day,
        model_name,
        model_version,
        attempts,
        completions,
        failures,
        retries,
        mean_queue_latency_seconds::float8           AS mean_queue_latency_seconds,
        p95_queue_latency_seconds::float8            AS p95_queue_latency_seconds,
        mean_scoring_latency_seconds::float8         AS mean_scoring_latency_seconds,
        p95_scoring_latency_seconds::float8          AS p95_scoring_latency_seconds
      FROM v_scoring_health
      ${where}
      ORDER BY day ASC, model_name ASC, model_version ASC
    `);

    return rows.map((r) => ({
      day: r.day,
      modelName: r.model_name,
      modelVersion: r.model_version,
      attempts: r.attempts,
      completions: r.completions,
      failures: r.failures,
      retries: r.retries,
      meanQueueLatencySeconds: r.mean_queue_latency_seconds,
      p95QueueLatencySeconds: r.p95_queue_latency_seconds,
      meanScoringLatencySeconds: r.mean_scoring_latency_seconds,
      p95ScoringLatencySeconds: r.p95_scoring_latency_seconds,
    }));
  }
}
