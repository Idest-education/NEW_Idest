"use client";

import Link from "next/link";
import { useState } from "react";
import type { BatchSummary, SubmissionStatus } from "../lib/api";
import { shortDate, taskLabel } from "../lib/format";
import { useApi, useLoad } from "../lib/use-api";
import { Icon } from "./icon";
import Image from "next/image";
import emptyBatches from "../public/illustrations/empty-batches.webp";
import { pageOf, Pager } from "./pager";
import styles from "./lists.module.css";

const DONE: SubmissionStatus[] = ["scored", "under_review", "published"];

export function progressOf(counts: Partial<Record<SubmissionStatus, number>>) {
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const done = DONE.reduce((a, s) => a + (counts[s] ?? 0), 0);
  const working = (counts.queued ?? 0) + (counts.scoring ?? 0);
  return { total, done, working, finalized: counts.published ?? 0, failed: counts.failed ?? 0, flagged: counts.abuse ?? 0 };
}

export function BatchesView() {
  const api = useApi();
  const [page, setPage] = useState(1);
  const { data, error } = useLoad("batches", api.batches, (list) => list.some((b) => progressOf(b.counts).working > 0), 5000);
  // shortcut: the API returns every batch, so pages are cut here; move to server paging past a few hundred.
  const view = data && pageOf(data, page);

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">Batches</h1>
        <Link href="/batches/new" className="btn btn-primary">
          <Icon name="add" /> New batch
        </Link>
      </div>
      {error && !data && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {error}
        </p>
      )}
      {!data && !error && <div className="skeleton" style={{ height: 180 }} />}
      {data?.length === 0 && (
        <div className={styles.empty}>
          <Image src={emptyBatches} alt="" sizes="300px" style={{ width: 300, height: "auto", maxWidth: "100%" }} />
          <p className={styles.emptyTitle}>Io can grade a whole class at once</p>
          <p className="muted">Upload photos, PDF, Word or Excel files. Io finds each essay, grades it, and hands you an Excel sheet back.</p>
          <Link href="/batches/new" className="btn btn-primary">
            Start a batch
          </Link>
        </div>
      )}
      {view && view.items.length > 0 && (
        <>
          <ul className={styles.cards} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {view.items.map((b) => (
              <BatchCard key={b.id} batch={b} />
            ))}
          </ul>
          <Pager page={view.page} totalPages={view.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function BatchCard({ batch }: { batch: BatchSummary }) {
  const p = progressOf(batch.counts);
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <li className={styles.card}>
      <Link href={`/batches/${batch.id}`} className={styles.title}>
        {batch.name}
      </Link>
      <span className="hint">
        {taskLabel(batch.taskType)} · {shortDate(batch.createdAt)}
      </span>
      <div className={styles.bar} aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="hint num">
        {p.total === 0
          ? `${batch.fileCount} file${batch.fileCount === 1 ? "" : "s"} · reading`
          : `${p.done} of ${p.total} graded · ${p.finalized} finalized`}
        {p.failed > 0 && ` · ${p.failed} failed`}
      </span>
    </li>
  );
}
