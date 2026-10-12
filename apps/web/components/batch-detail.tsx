"use client";

import Link from "next/link";
import { useState } from "react";
import { describeError, type BatchDetail as Detail, type IntakeStatus } from "../lib/api";
import { band, bandTone, fileSize, isWorking, saveBlob, STATUS_LABEL, taskLabel } from "../lib/format";
import { Io } from "./io";
import { useToast } from "./toast";
import { useApi, useLoad } from "../lib/use-api";
import { progressOf } from "./batches-view";
import { DropZone } from "./composer-parts";
import { Icon } from "./icon";
import { ReasonTagger } from "./reason-tagger";
import { Notice } from "./session";
import styles from "./batch-detail.module.css";
import lists from "./lists.module.css";

const FILE_STATUS: Record<IntakeStatus, string> = {
  pending: "Waiting",
  extracting: "Reading",
  extracted: "Read",
  failed: "Couldn't read",
};

const busy = (d: Detail) =>
  d.files.some((f) => f.status === "pending" || f.status === "extracting") || d.items.some((i) => isWorking(i.status));

export function BatchDetail({ id, uploadFailed }: { id: string; uploadFailed: boolean }) {
  const api = useApi();
  const { data, error, reload } = useLoad(`batch:${id}`, () => api.batch(id), busy);
  const untagged = useLoad(`untagged:${id}`, () => api.untagged(id));
  const [adding, setAdding] = useState<File[]>([]);
  const toast = useToast();
  const [note, setNote] = useState<string | null>(
    uploadFailed ? "The batch was created, but the upload failed. Add the files again below." : null,
  );
  const [working, setWorking] = useState<"retry" | "export" | "upload" | null>(null);
  const [tagging, setTagging] = useState(false);

  if (error && !data) {
    return (
      <Notice io="oops" title="We couldn't load this batch" body={error}>
        <button className="btn btn-secondary" onClick={reload}>
          Try again
        </button>
      </Notice>
    );
  }
  if (!data) {
    return (
      <div className="page" aria-busy="true">
        <div className="skeleton" style={{ height: 48, width: "60%" }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    );
  }

  const counts = data.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.status]: (acc[i.status] ?? 0) + 1 }), {});
  const p = progressOf(counts);
  const reading = data.files.filter((f) => f.status === "pending" || f.status === "extracting").length;
  const stuck = data.files.some((f) => f.status === "failed") || data.items.some((i) => i.status === "failed" || i.status === "submitted");
  const fileName = new Map(data.files.map((f) => [f.id, f.fileName]));
  const room = 30 - data.files.length;
  const untaggedCount = untagged.data?.length ?? 0;

  const act = async (kind: "retry" | "export" | "upload") => {
    setWorking(kind);
    setNote(null);
    try {
      if (kind === "retry") {
        const r = await api.retryBatch(id);
        toast(r.files + r.essays === 0 ? "Nothing needed sending again." : `Sent again: ${r.files} file(s), ${r.essays} essay(s).`);
      } else if (kind === "export") {
        const { blob, fileName: name } = await api.exportBatch(id);
        saveBlob(blob, name);
        toast(`Excel ready: ${name}`);
      } else {
        await api.addFiles(id, adding);
        setAdding([]);
        toast("Files added. Io is reading them now.");
      }
      reload();
    } catch (err) {
      setNote(describeError(err));
    } finally {
      setWorking(null);
    }
  };

  const status =
    reading > 0
      ? `Reading ${reading} file${reading === 1 ? "" : "s"}…`
      : p.working > 0
        ? `Grading: ${p.done} of ${p.total} done.`
        : p.total > 0
          ? `All ${p.total} essays graded.`
          : "No essays yet.";

  return (
    <div className="page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <Link href="/batches" className="hint">
            Batches
          </Link>
          <h1 className="page-title">{data.name}</h1>
        </div>
        <div className="row">
          {stuck && (
            <button className="btn btn-secondary" onClick={() => act("retry")} disabled={working !== null}>
              <Icon name="refresh" /> Retry stuck
            </button>
          )}
          <button className="btn btn-primary" onClick={() => act("export")} disabled={working !== null || p.total === 0}>
            <Icon name="download" /> {working === "export" ? "Preparing" : "Download Excel"}
          </button>
        </div>
      </div>

      <section className={`card ${styles.task}`} aria-label="Task">
        <span className="chip">{taskLabel(data.taskType)}</span>
        <p className={styles.prompt}>{data.taskPrompt}</p>
        {data.taskImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- remote chart from the API host
          <img src={data.taskImageUrl} alt="Task 1 chart" className={styles.chart} />
        )}
      </section>

      <section className={styles.progress} aria-label="Progress">
        <Io
          mood={reading > 0 || p.working > 0 ? "busy" : p.total > 0 && p.done === p.total ? "celebrate" : p.failed > 0 ? "oops" : "idle"}
          size={56}
          className={styles.progressIo}
        />
        <div className={lists.bar} aria-hidden="true">
          <span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} />
        </div>
        <p role="status" aria-live="polite" className="num">
          <strong>{status}</strong>{" "}
          <span className="muted">
            {p.finalized} finalized
            {p.failed > 0 && ` · ${p.failed} failed`}
            {p.flagged > 0 && ` · ${p.flagged} flagged`}
          </span>
        </p>
      </section>

      {note && (
        <p className="alert alert-danger" role="alert">
          <Icon name="error" /> {note}
        </p>
      )}

      {untaggedCount > 0 && (
        <div className={`alert ${styles.reasons}`}>
          <Icon name="label" />
          <span>
            {untaggedCount} changed score{untaggedCount === 1 ? " has" : "s have"} no reason yet. Tagging why helps us
            improve the grader.
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => setTagging(true)}>
            Add reasons
          </button>
        </div>
      )}

      <section className="stack" aria-labelledby="files-h">
        <h2 id="files-h" className={styles.h2}>
          Files <span className="hint num">{data.files.length} / 30</span>
        </h2>
        <ul className={styles.files}>
          {data.files.map((f) => (
            <li key={f.id} className={styles.file} title={f.error ?? undefined}>
              <Icon
                name={f.status === "failed" ? "error" : f.status === "extracted" ? "check_circle" : "progress_activity"}
                className={f.status === "failed" ? styles.bad : f.status === "extracted" ? styles.good : styles.spin}
              />
              <span className={styles.fileName}>{f.fileName}</span>
              <span className="hint num">{fileSize(f.sizeBytes)}</span>
              <span className={`chip ${f.status === "failed" ? "chip-danger" : ""}`}>{FILE_STATUS[f.status]}</span>
            </li>
          ))}
        </ul>
        {room > 0 && (
          <details className={styles.add} open={data.files.length === 0}>
            <summary className="btn btn-ghost btn-sm">
              <Icon name="add" /> Add files
            </summary>
            <div className="stack" style={{ marginTop: 8 }}>
              <DropZone files={adding} onChange={setAdding} max={room} />
              {adding.length > 0 && (
                <button className="btn btn-primary" onClick={() => act("upload")} disabled={working !== null} style={{ justifySelf: "start" }}>
                  <Icon name="upload_file" /> {working === "upload" ? "Uploading" : `Upload ${adding.length} file${adding.length === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          </details>
        )}
      </section>

      <section className="stack" aria-labelledby="essays-h">
        <h2 id="essays-h" className={styles.h2}>
          Essays <span className="hint num">{data.items.length}</span>
        </h2>
        {data.items.length === 0 ? (
          <p className="muted">{reading > 0 ? "Essays appear here as each file is read." : "No essays found yet."}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Source</th>
                  <th scope="col" className={styles.numCol}>
                    Words
                  </th>
                  <th scope="col" className={styles.numCol}>
                    AI
                  </th>
                  <th scope="col" className={styles.numCol}>
                    Final
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item, i) => (
                  <tr key={item.id}>
                    <th scope="row">
                      <Link href={`/review/${item.id}`} className={styles.rowLink}>
                        {item.studentLabel || `Essay ${i + 1}`}
                      </Link>
                    </th>
                    <td className={styles.source} data-label="Source">
                      {(item.sourceFileId && fileName.get(item.sourceFileId)) || "—"}
                    </td>
                    <td className={`${styles.numCol} num`} data-label="Words">
                      {item.wordCount}
                    </td>
                    <td className={`${styles.numCol} num ${item.aiScores ? `tone-${bandTone(item.aiScores.overall)}` : ""}`} data-label="AI">
                      {band(item.aiScores?.overall)}
                    </td>
                    <td
                      className={`${styles.numCol} num ${styles.final} ${item.finalScores ? `tone-${bandTone(item.finalScores.overall)}` : ""}`}
                      data-label="Final"
                    >
                      {band(item.finalScores?.overall)}
                    </td>
                    <td data-label="Status">
                      <span
                        className={`chip ${
                          item.status === "published"
                            ? "chip-ok"
                            : item.status === "failed"
                              ? "chip-danger"
                              : item.status === "abuse"
                                ? "chip-mark"
                                : item.status === "scored"
                                  ? "chip-accent"
                                  : ""
                        }`}
                      >
                        {STATUS_LABEL[item.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {tagging && untagged.data && (
        <ReasonTagger
          revisions={untagged.data}
          onClose={(saved) => {
            setTagging(false);
            if (saved) untagged.reload();
          }}
        />
      )}
    </div>
  );
}
