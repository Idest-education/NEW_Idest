# Grading-Tool Pivot — Design

**Date:** 2026-10-11
**Status:** Implemented on branch `feat/grading-tool-pivot`
**ClickUp mirror:** System Design › Grading-Tool Pivot (`z8rp3etr9y-798`)
**ClickUp:** Sprint 3 — Home screen, Remove Class management, OCR Essay, Bulk Grading, Agent Excel cleaning,
Export grades as Excel, Translate UI to English. Branding (new name/logo) is out of scope until the client names it.

## 1. Context

The client asked to redo the web. Idest moves from a class/assignment LMS with a teacher-in-the-loop review
workflow to a **free web tool for grading IELTS Writing**:

- **Anyone, no account:** grade one essay (typed text or photos of a handwritten essay).
- **Signed-in teachers:** everything above, plus **bulk grading** from images, PDF, Word (`.doc`/`.docx`) and
  Excel (`.xls`/`.xlsx`/`.csv`), review/edit/finalize each AI score, and download the scores as Excel.

Everything is free. The UI and AI feedback are English.

This is a direction change, not a rewrite. The scoring pipeline (RabbitMQ → ai-service → append-only
`scoring_results` with `ai_model_versions`), teacher revisions (`score_revisions`), finalization
(`published_results`), revision reason tags and analytics are reused unchanged.

## 2. Decisions

| # | Decision |
| --- | --- |
| D1 | Teacher stays in the loop for teacher-owned work. Bulk results are AI drafts; the teacher may edit (new `score_revisions` row) and finalize (`published_results`). The thesis benchmark data keeps flowing. |
| D2 | Anonymous gradings show the AI result directly — nobody reviews them. If a signed-in teacher graded it and later finalized it, the result page shows the teacher's version. |
| D3 | LMS features (classes, assignments, student workspace, invites, onboarding, redo requests) are **hidden, not deleted**. Their tables and server endpoints stay; their web routes redirect home (`isRetiredPath`). |
| D4 | Anonymous essays and results are **stored**, with a privacy notice under the form. The result page is readable by anyone holding its UUID. |
| D5 | The task question is **required**, with Task 1/Task 2 and an optional Task 1 chart image. In a batch, one batch question applies unless a spreadsheet row or document names its own. |
| D6 | Photo input: a single user **confirms and corrects the transcript** before grading. Bulk photos are transcribed and graded automatically; the teacher sees the essay text on the review page. |
| D7 | The model never rewrites an essay. For documents it returns line ranges; for spreadsheets a column mapping; code cuts the student's exact words out of the source. A mapping that fails validation gets one correction round, then a heuristic fallback (longest-text column = essays). |
| D8 | Uploaded files are stored as bytes in Postgres (`intake_files.content BYTEA[]`) and sent base64 inside the extraction job. Reason: Cloudinary's free tier blocks raw/PDF delivery by default, and the Excel export needs the teacher's original workbook. Shortcut, max 20MB/file; move to object storage if volume grows. |
| D9 | Free quota: anonymous callers get `PUBLIC_DAILY_LIMIT` (default 10) gradings + transcriptions per 24h per HMAC'd IP (`Fly-Client-IP`, `CLIENT_HASH_SECRET` falling back to `CLERK_SECRET_KEY`). Signed-in teachers get `TEACHER_DAILY_LIMIT` (default 100) per 24h per account. Everyone also has `HOURLY_LIMIT` (default 30) per rolling hour. Throttler bursts: 5/min on public POSTs. |
| D10 | Abuse heuristics (`detectAbuse`) still run. A public essay that trips them is rejected with 400 and not stored (no teacher exists to review it). A batch essay that trips them is stored as `abuse` for the teacher to decide. |
| D11 | `GET /grade/quota` returns the gradings left in the tighter of the daily and hourly windows (`{ remaining, limit, window }`); the composer shows it, with a sign-up link for anonymous visitors. |
| D12 | Follow-up chat on a graded public essay (`GET/POST /grade/:id/chat`). Only the essay's owner may ask (teacher account, or the same IP hash for an anonymous essay). Cap per essay: 1 question anonymous, 5 signed in; failed answers do not count; one question in flight at a time (a turn unanswered after 5 minutes is marked failed). Each turn is a `chat_turns` row. The server sends the task, essay, shown assessment and earlier answers on `ai_chat_queue`; the ai-service `ChatWorker` answers with the extraction LLM and replies on `ai_chat_results_queue`. Chat never changes a score and does not spend the grading quota. |

## 3. Data model

Migration `20261011120000_decouple_submissions_for_grading_tool`:

- `submissions`: `assignment_id`, `student_id`, `attempt_number` become nullable. New columns: `source`
  (`assignment | public | batch`, backfilled `assignment`), task snapshot `task_type`, `task_prompt`,
  `task_image_url` (backfilled from `assignments`, then `NOT NULL` for type and prompt), `owner_id`,
  `batch_id`, `source_file_id`, `source_ref JSONB` (sheet, row, original cells, student label), `client_hash`.
- CHECK `submissions_source_owner_check`: `assignment` rows need assignment + student + attempt; `batch` rows
  need batch + owner.
- New `grading_batches` (teacher, name, task type/prompt/chart) and `intake_files` (owner, batch, kind,
  file name, `content BYTEA[]`, `mime_types`, `size_bytes`, `status pending|extracting|extracted|failed`,
  `extraction JSONB`, `error`, `client_hash`).
- `v_assessment_outcomes` now `LEFT JOIN`s `assignments` and reads `task_type` from the submission, so tool
  gradings appear in analytics. Recreated with `CREATE OR REPLACE` (same columns), so dependent views stay valid.

Ownership: `submissionOwnerId(s) = s.assignment?.teacherId ?? s.ownerId` is used by every teacher check
(revisions, publish, history, retry, review session). An anonymous submission has no owner, so no teacher can
manage it.

## 4. Flows

**Single essay (public).** `POST /grade` (multipart; optional `taskImage`) → quota → `detectAbuse` → submission
`source=public` → `scoringJobFor(submission)` on `ai_scoring_queue` → `queued`. The web app redirects to
`/r/{id}`, which polls `GET /grade/{id}`. `POST /grade/{id}/retry` re-queues a `failed` or never-queued essay.

**Photo.** `POST /grade/transcribe` (1–5 images, ≤10MB each) → `intake_files` row → job on
`ai_extraction_queue` → `GET /grade/transcribe/{id}` until `extracted`. The text fills the essay box with a
"check it against your photo" notice, and `transcriptionId` links the graded submission to its photos.

**Bulk.** `POST /batches` → `POST /batches/{id}/files` (≤30 files/batch, ≤20MB each) → one intake file and
extraction job per file. The extraction result creates one `source=batch` submission per essay, inside one
transaction with the file's status (≤200 essays per batch; a redelivered result is ignored), then queues the clean
ones for scoring. `/teacher/batches/{id}` polls progress; each row opens the existing review sheet
(edit → Save draft → Finalize). `POST /batches/{id}/retry` re-sends unread files and unscored essays.

**Export.** `GET /batches/{id}/export` (exceljs). If the batch is a single `.xlsx`, the teacher's own workbook
comes back with Overall, TR, CC, LR, GRA, Feedback and Grading status appended to each essay's row (calamine row
index + 1 = Excel row). Otherwise it returns a `Results` sheet. Scores are the live published result if there is
one, otherwise the AI result.

## 5. ai-service extraction

`extraction/` package, started next to `ScoringWorker` in `main.py`:

- `readers.py` — PDF (pymupdf; pages under 40 chars are rendered at 150 dpi for OCR), `.docx` (python-docx),
  `.doc` (`antiword`, installed in the Dockerfile), `.xls/.xlsx` (python-calamine), `.csv`.
- `llm.py` — `transcribe(images)` and `complete_json(system, user, schema)`. Gemini when keyed, else OpenAI, else a
  stub. Throttled by its own `RateLimiter(MIN_SECONDS_BETWEEN_CALLS)`. Shortcut: this is separate from the
  grader's limiter.
- `essays.py` — photos → one essay; documents → line-numbered text → `Segmentation` line ranges; sheets → preview
  of the first 15 rows → `SheetMapping` → validation → one essay per data row.
- `worker.py` — retries with `retry.next_delay` (a `ValueError` fails fast), then publishes
  `{fileId, status, essays, mapping, headers, error, extractor}`.

Extraction output never becomes a score, so it has no `ai_model_versions` identity.

## 6. Web

- `/` is the grading tool (ChatGPT-like single form); `/r/[id]` is the shareable result.
- `/teacher` lists batches and the teacher's own single gradings; `/teacher/batches/new`;
  `/teacher/batches/[id]`.
- The review sheet works without an assignment (task fields come from the submission; redo is hidden for tool
  essays). Revision-reason tagging also works per batch (`GET /batches/{id}/revisions/untagged`).
- English UI everywhere visible. The feedback survey (UMUX-Lite research instrument, SPSS export) stays in
  Vietnamese until it is re-validated in English.

## 7. Non-negotiable rules, revisited

- Rule 4 now reads: a user sees only their own AI result or a teacher-finalized result — never another user's
  essays, revisions or notes. An anonymous essay is reachable only through its unguessable id.
- Rules 2, 3, 5, 6 and 7 are unchanged and still enforced by the reused persistence code.

## 8. Risks

- The thesis assignment text promises a student-views-after-teacher-approval workflow; confirm the reframing with
  the supervisor.
- Throughput: the grader's 6s floor puts a 200-essay batch at 20+ minutes, plus extraction calls.
- Anonymous endpoints spend LLM quota. The quota is per IP hash. Anonymous `POST /grade` and `POST /grade/transcribe` also need a Cloudflare Turnstile token (`CF-Turnstile-Response` header; actions `grade` and `transcribe`). The server checks `success`, the route's action and the frontend hostname against `TURNSTILE_HOSTNAMES`, with `TURNSTILE_SECRET` from Fly secrets. The web gets `NEXT_PUBLIC_TURNSTILE_SITE_KEY` as a build arg in `fly.toml`. Signed-in callers skip it. The check fails closed in production.
