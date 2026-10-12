"use client";

import { useState } from "react";
import { CRITERIA, describeError } from "../lib/api";
import { saveBlob } from "../lib/format";
import { useApi, useLoad } from "../lib/use-api";
import { Icon } from "./icon";
import styles from "./admin-view.module.css";

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const secs = (n: number | null) => (n === null ? "—" : n < 90 ? `${Math.round(n)} s` : `${(n / 60).toFixed(1)} min`);
const num = (n: number | null) => (n === null ? "—" : n.toFixed(2));

export function AdminView() {
  const api = useApi();
  const overview = useLoad("overview", api.overview);
  const health = useLoad("health", api.scoringHealth);
  const [exporting, setExporting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportAs = async (format: "csv" | "jsonl") => {
    setExporting(format);
    setError(null);
    try {
      const { blob, fileName } = await api.exportAnalytics(format);
      saveBlob(blob, fileName);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setExporting(null);
    }
  };

  const o = overview.data;
  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Analytics</h1>
        <div className="row">
          <button className="btn btn-secondary" onClick={() => exportAs("csv")} disabled={exporting !== null}>
            <Icon name="download" /> {exporting === "csv" ? "Exporting" : "Export CSV"}
          </button>
          <button className="btn btn-secondary" onClick={() => exportAs("jsonl")} disabled={exporting !== null}>
            <Icon name="download" /> {exporting === "jsonl" ? "Exporting" : "Export JSONL"}
          </button>
        </div>
      </div>
      {(error || overview.error) && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {error ?? overview.error}
        </p>
      )}
      {!o && !overview.error && <div className="skeleton" style={{ height: 200 }} />}
      {o && (
        <>
          <section aria-label="Teacher agreement" className={styles.tiles}>
            <Tile label="Finalized results" value={String(o.totals.publishedCount)} />
            <Tile label="Essays with a teacher edit" value={String(o.totals.submissionsWithRevision)} />
            <Tile label="Teacher changed the AI band" value={pct(o.agreement.overrideRate)} />
            <Tile label="Reasons tagged" value={pct(o.process.reasonTaggedRate)} />
            <Tile label="Mean review time" value={secs(o.process.meanReviewDurationSeconds)} />
          </section>
          <section aria-label="Scoring" className={styles.tiles}>
            <Tile label="Scoring attempts" value={String(o.scoring.attempts)} />
            <Tile label="Failure rate" value={pct(o.scoring.failureRate)} />
            <Tile label="Retries" value={String(o.scoring.retries)} />
            <Tile label="Time in queue" value={secs(o.scoring.meanQueueLatencySeconds)} />
            <Tile label="Time to score" value={secs(o.scoring.meanScoringLatencySeconds)} />
          </section>
          <section className="card stack">
            <h2 className={styles.h2}>Mean AI-vs-teacher gap (bands)</h2>
            <dl className={styles.deltas}>
              {[...CRITERIA, { key: "overall" as const, short: "Overall", name: "Overall" }].map((c) => (
                <div key={c.key}>
                  <dt>{c.short}</dt>
                  <dd className="num">{num(o.agreement.meanAbsDelta[c.key])}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
      <section className="card stack" aria-labelledby="health-h">
        <h2 id="health-h" className={styles.h2}>
          Scoring health by day
        </h2>
        {health.error && <p className="muted">{health.error}</p>}
        {health.data?.length === 0 && <p className="muted">No scoring yet.</p>}
        {health.data && health.data.length > 0 && (
          <div className={styles.scroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Model</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Done</th>
                  <th scope="col">Failed</th>
                  <th scope="col">Retries</th>
                  <th scope="col">Queue</th>
                </tr>
              </thead>
              <tbody>
                {health.data.map((r) => (
                  <tr key={`${r.day}${r.modelName}${r.modelVersion}`} className="num">
                    <td>{r.day.slice(0, 10)}</td>
                    <td>
                      {r.modelName} <span className="hint">{r.modelVersion}</span>
                    </td>
                    <td>{r.attempts}</td>
                    <td>{r.completions}</td>
                    <td>{r.failures}</td>
                    <td>{r.retries}</td>
                    <td>{secs(r.meanQueueLatencySeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.tile}>
      <span className={`${styles.value} num`}>{value}</span>
      <span className="hint">{label}</span>
    </div>
  );
}
