"use client";

import { useRouter } from "next/navigation";
import { useState, type ClipboardEvent, type FormEvent } from "react";
import { describeError, type TaskType } from "../lib/api";
import { useApi } from "../lib/use-api";
import { ChartPicker, DropZone, pastedImage, TaskToggle } from "./composer-parts";
import { useToast } from "./toast";
import { Icon } from "./icon";
import { useAccount } from "./session";
import styles from "./composer.module.css";

export function NewBatch() {
  const api = useApi();
  const router = useRouter();
  const { bumpRecents } = useAccount();
  const [name, setName] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("task_2");
  const [prompt, setPrompt] = useState("");
  const [chart, setChart] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const onPaste = (e: ClipboardEvent) => {
    const image = pastedImage(e);
    if (!image) return;
    toast(taskType === "task_1" ? "Chart added." : "Chart added. Switched to Task 1.");
    setTaskType("task_1");
    setChart(image);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Give the batch a name, like the class and week.");
    if (!prompt.trim()) return setError("Add the question the essays answer.");
    if (files.length === 0) return setError("Add at least one file.");
    setBusy(true);
    let batchId: string | null = null;
    try {
      const batch = await api.createBatch({
        name: name.trim(),
        taskType,
        taskPrompt: prompt.trim(),
        taskImage: taskType === "task_1" && chart ? chart : undefined,
      });
      batchId = batch.id;
      await api.addFiles(batch.id, files);
      bumpRecents();
      router.push(`/batches/${batch.id}`);
    } catch (err) {
      setBusy(false);
      // The batch exists even if the upload failed: open it, so files can be added there.
      if (batchId) {
        bumpRecents();
        router.push(`/batches/${batchId}?upload=failed`);
      } else setError(describeError(err));
    }
  }

  return (
    <div className={styles.wrap}>
      <h1 className={styles.greeting}>Grade a whole class.</h1>
      <p className={styles.sub}>One question, many essays. Photos, PDF, Word or Excel; AIO finds each essay.</p>

      <form className={styles.card} onSubmit={submit} onPaste={onPaste} noValidate>
        <div className={styles.head}>
          <TaskToggle value={taskType} onChange={setTaskType} />
          {taskType === "task_1" && <ChartPicker file={chart} onChange={setChart} />}
        </div>
        <div className={styles.fields}>
          <div className="field">
            <label className="label" htmlFor="batch-name">
              Batch name
            </label>
            <input
              id="batch-name"
              className="input"
              placeholder="e.g. Class 10A, week 3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={160}
              required
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="batch-question">
              Question
            </label>
            <textarea
              id="batch-question"
              className="textarea"
              rows={3}
              placeholder="The question every essay answers. A spreadsheet row or document that names its own question keeps it."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={4000}
              required
            />
          </div>
          <DropZone files={files} onChange={setFiles} max={30} />
        </div>
        <div className={styles.foot}>
          <span className="hint num">
            {files.length} file{files.length === 1 ? "" : "s"}
          </span>
          <span className={styles.spacer} />
          <button type="submit" className={`btn btn-primary ${styles.send}`} disabled={busy}>
            {busy ? <Icon name="progress_activity" className={styles.spin} /> : <Icon name="arrow_upward" />}
            {busy ? "Uploading" : "Start grading"}
          </button>
        </div>
        {error && (
          <p className="alert alert-danger" role="alert" style={{ margin: 4 }}>
            <Icon name="error" /> {error}
          </p>
        )}
      </form>
    </div>
  );
}
