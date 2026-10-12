"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "./icon";
import { band, bandTone, isWorking, shortDate, STATUS_LABEL, taskLabel } from "../lib/format";
import { Io } from "./io";
import { PAGE_SIZE, Pager } from "./pager";
import { useApi, useLoad } from "../lib/use-api";
import styles from "./lists.module.css";

export function HistoryView() {
  const api = useApi();
  const [page, setPage] = useState(1);
  const { data, error } = useLoad(`mine:${page}`, () => api.mine(page, PAGE_SIZE), (d) => d.data.some((g) => isWorking(g.status)));

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">History</h1>
        <Link href="/" className="btn btn-primary">
          <Icon name="edit_square" /> New grading
        </Link>
      </div>
      {error && !data && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {error}
        </p>
      )}
      {!data && !error && <div className="skeleton" style={{ height: 240 }} />}
      {data && data.data.length === 0 && (
        <div className={styles.empty}>
          <Io mood="idle" size={96} />
          <p className={styles.emptyTitle}>Nothing graded yet</p>
          <p className="muted">Essays you grade while signed in land here, so you can come back to them.</p>
          <Link href="/" className="btn btn-primary">
            Grade an essay
          </Link>
        </div>
      )}
      {data && data.data.length > 0 && (
        <ul className={styles.list}>
          {data.data.map((g) => (
            <li key={g.id} className={styles.item}>
              <span className={`${styles.band} num ${g.aiScores ? `tone-${bandTone(g.aiScores.overall)}` : ""}`}>{band(g.aiScores?.overall)}</span>
              <div className={styles.main}>
                <Link href={`/r/${g.id}`} className={styles.title}>
                  {g.taskPrompt}
                </Link>
                <span className="hint">
                  {taskLabel(g.taskType)} · <span className="num">{g.wordCount}</span> words · {shortDate(g.submittedAt)}
                </span>
              </div>
              <span className={`chip ${g.status === "failed" ? "chip-danger" : g.status === "published" ? "chip-ok" : ""}`}>
                {STATUS_LABEL[g.status]}
              </span>
              <Link href={`/review/${g.id}`} className="btn btn-ghost btn-sm">
                Review
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && <Pager page={data.page} totalPages={data.totalPages} onChange={setPage} />}
    </div>
  );
}
