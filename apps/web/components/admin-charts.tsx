"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CRITERIA, CRITERION_ABBR, type Criterion } from "../lib/idest";
import type { AnalyticsOverview, ScoringHealthRow } from "../lib/analytics";
import styles from "../app/admin/admin.module.css";

function fixed(value: number | null, digits: number): string {
  return value === null ? "—" : value.toFixed(digits);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.card}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardValue}>{value}</span>
      {hint ? <span className={styles.cardHint}>{hint}</span> : null}
    </div>
  );
}

export function HeadlineCards({ overview }: { overview: AnalyticsOverview }) {
  return (
    <div className={styles.cards}>
      <Card
        label="Bài đã chấm lại"
        value={String(overview.totals.submissionsWithRevision)}
        hint={`${overview.totals.publishedCount} đã duyệt`}
      />
      <Card
        label="Có điểm AI để so"
        value={String(overview.agreement.rowsWithAiBaseline)}
        hint="Các dòng không có điểm AI bị loại khỏi mọi chỉ số đồng thuận"
      />
      <Card
        label="Tỷ lệ sửa điểm AI"
        value={percent(overview.agreement.overrideRate)}
        hint={`${overview.agreement.overrideCount} lần`}
      />
      <Card
        label="Lệch tuyệt đối (overall)"
        value={fixed(overview.agreement.meanAbsDelta.overall, 2)}
        hint="band"
      />
      <Card
        label="Tỷ lệ AI chấm lỗi"
        value={percent(overview.scoring.failureRate)}
        hint={`${overview.scoring.failures}/${overview.scoring.attempts} lượt`}
      />
      <Card
        label="Chờ hàng đợi"
        value={`${fixed(overview.scoring.meanQueueLatencySeconds, 1)}s`}
        hint={`AI chấm ${fixed(overview.scoring.meanScoringLatencySeconds, 1)}s`}
      />
      <Card
        label="Thời gian giáo viên duyệt"
        value={`${fixed(overview.process.meanReviewDurationSeconds, 0)}s`}
      />
      <Card
        label="Bản sửa có lý do"
        value={percent(overview.process.reasonTaggedRate)}
      />
    </div>
  );
}

export function DeltaBars({ overview }: { overview: AnalyticsOverview }) {
  const data = CRITERIA.map((criterion: Criterion) => ({
    criterion: CRITERION_ABBR[criterion],
    meanAbsDelta: overview.agreement.meanAbsDelta[criterion] ?? 0,
  })).concat([
    { criterion: "Overall", meanAbsDelta: overview.agreement.meanAbsDelta.overall ?? 0 },
  ]);

  return (
    <div className={styles.chartFrame}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="criterion" tickLine={false} />
          <YAxis
            tickLine={false}
            width={44}
            label={{ value: "band", angle: -90, position: "insideLeft" }}
          />
          <Tooltip
            formatter={(value) =>
              // recharts 3 types this as ValueType | undefined, so narrow before
              // formatting rather than asserting the number away.
              typeof value === "number" ? value.toFixed(2) : String(value ?? "")
            }
          />
          <Bar dataKey="meanAbsDelta" name="Lệch tuyệt đối trung bình" fill="#8b5e34" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LatencySeries({ rows }: { rows: ScoringHealthRow[] }) {
  return (
    <div className={styles.chartFrame}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickLine={false} />
          <YAxis
            tickLine={false}
            width={52}
            label={{ value: "giây", angle: -90, position: "insideLeft" }}
          />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="meanQueueLatencySeconds"
            name="Chờ hàng đợi (TB)"
            stroke="#8b5e34"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="p95QueueLatencySeconds"
            name="Chờ hàng đợi (p95)"
            stroke="#c49a6c"
            strokeDasharray="4 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="meanScoringLatencySeconds"
            name="AI chấm (TB)"
            stroke="#3d5a5b"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AttemptBars({ rows }: { rows: ScoringHealthRow[] }) {
  return (
    <div className={styles.chartFrame}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickLine={false} />
          <YAxis tickLine={false} width={44} allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="completions" name="Thành công" stackId="a" fill="#3d5a5b" />
          <Bar dataKey="failures" name="Lỗi" stackId="a" fill="#a4443a" />
          <Bar dataKey="retries" name="Chấm lại" fill="#c49a6c" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
