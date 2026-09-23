import { apiFetch } from "./api";
import { ApiError } from "./idest";

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

/** Builds `?from=…&to=…`, omitting whichever bound was not given. */
export function windowQuery(window: DateWindow): string {
  const params = new URLSearchParams();
  if (window.from) params.set("from", window.from);
  if (window.to) params.set("to", window.to);
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function getJson<T>(path: string, token: string | null): Promise<T> {
  let res: Response;
  try {
    // Not cached: apps/web/next.config.js does not enable cacheComponents, so
    // fetch is uncached by default, and `no-store` also stops this request
    // being hoisted into a build-time prerender.
    res = await apiFetch(path, token, { cache: "no-store" });
  } catch {
    throw new ApiError(0, "Không kết nối được máy chủ Idest.");
  }
  if (!res.ok) throw new ApiError(res.status, `Máy chủ trả lỗi ${res.status}.`);
  return (await res.json()) as T;
}

export const fetchOverview = (token: string | null) =>
  getJson<AnalyticsOverview>("/analytics/overview", token);

export const fetchScoringHealth = (token: string | null, window: DateWindow) =>
  getJson<ScoringHealthRow[]>(`/analytics/scoring-health${windowQuery(window)}`, token);
