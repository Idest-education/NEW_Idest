"use client";

import { useRef, useState, type FormEvent } from "react";
import { describeError } from "../lib/api";
import { shortDate } from "../lib/format";
import { useApi, useLoad } from "../lib/use-api";
import { IMAGE_TYPES } from "./composer-parts";
import { Icon } from "./icon";
import { pageOf, Pager } from "./pager";
import { useToast } from "./toast";

export function HelpView() {
  const api = useApi();
  const tickets = useLoad("tickets", api.tickets);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [images, setImages] = useState<File[]>([]);
  const toast = useToast();
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1);
  const view = tickets.data && pageOf(tickets.data, page);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api.createTicket({ subject: subject.trim(), message: message.trim(), images });
      setSubject("");
      setMessage("");
      setImages([]);
      setState({});
      toast("Sent. Thanks for telling us.");
      tickets.reload();
    } catch (err) {
      setState({ error: describeError(err) });
    }
  };

  return (
    <div className="page page-narrow">
      <h1 className="page-title">Help</h1>
      <form className="card stack" onSubmit={send}>
        <h2 style={{ fontSize: "var(--fs-18)" }}>Tell us what went wrong</h2>
        <p className="muted">We read every message and reply by email.</p>
        <div className="field">
          <label className="label" htmlFor="t-subject">
            Subject
          </label>
          <input id="t-subject" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="t-message">
            What happened?
          </label>
          <textarea
            id="t-message"
            className="textarea"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            required
          />
        </div>
        <div className="row">
          <input
            ref={fileInput}
            type="file"
            accept={IMAGE_TYPES}
            multiple
            hidden
            onChange={(e) => {
              setImages([...(e.target.files ?? [])].slice(0, 3));
              e.target.value = "";
            }}
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileInput.current?.click()}>
            <Icon name="add_photo_alternate" /> Screenshots (up to 3)
          </button>
          {images.length > 0 && <span className="hint">{images.map((f) => f.name).join(", ")}</span>}
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={state.busy || !subject.trim() || !message.trim()}>
            {state.busy ? "Sending" : "Send"}
          </button>
        </div>
        {state.error && (
          <p className="alert alert-danger" role="alert">
            <Icon name="error" /> {state.error}
          </p>
        )}
      </form>

      <section className="stack" aria-labelledby="tickets-h">
        <h2 id="tickets-h" style={{ fontSize: "var(--fs-18)" }}>
          Tickets we received
        </h2>
        {tickets.error && !tickets.data && <p className="muted">{tickets.error}</p>}
        {!tickets.data && !tickets.error && <div className="skeleton" style={{ height: 80 }} />}
        {tickets.data?.length === 0 && <p className="muted">Nothing yet.</p>}
        {view?.items.map((t) => (
          <article key={t.id} className="card stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{t.subject}</strong>
              <span className={`chip ${t.statusType === "done" || t.statusType === "closed" ? "chip-ok" : ""}`}>{t.status}</span>
            </div>
            <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
              {t.message}
            </p>
            {!!t.attachments?.length && (
              <ul className="row" style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label="Attached images">
                {t.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={a.url} target="_blank" rel="noreferrer" title={a.title ?? "Open image"}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- remote ClickUp attachment */}
                      <img
                        src={a.thumbnailUrl ?? a.url}
                        alt={a.title ?? "Attached screenshot"}
                        loading="lazy"
                        style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <span className="hint">{shortDate(t.createdAt)}</span>
          </article>
        ))}
        {view && <Pager page={view.page} totalPages={view.totalPages} onChange={setPage} />}
      </section>
    </div>
  );
}
