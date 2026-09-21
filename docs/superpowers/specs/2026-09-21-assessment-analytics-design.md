# Assessment Analytics and Decision Tracking — Design

- **Date:** 2026-09-21
- **Status:** Approved design, not yet planned
- **Scope:** `apps/server`, `apps/web`, `apps/ai-service`, PostgreSQL schema
- **Related:** CLAUDE.md non-negotiable rules 2, 3, 6; ClickUp AI Scoring & Evaluation (`z8rp3etr9y-378`); ADR 003 (`z8rp3etr9y-578`)

## 1. Goal

Make the thesis measurable. The system must produce, from data it already collects plus a small number of new signals:

1. **Agreement between the LLM and the teacher** — quadratic weighted kappa, exact agreement, agreement within half a band, mean absolute error, rank correlation, per criterion and overall.
2. **Override behaviour** — how often a teacher changes an AI score, by how much, in which direction, on which criterion, and *why*.
3. **Process health** — queue latency, scoring latency, failure and retry rate, review duration, publish and unpublish counts, broken down by AI model version.
4. **A benchmark dataset** — an export suitable for training and evaluating the CatBoost model against both the LLM and the teacher, as required by ADR 003.

Consumers are the two thesis authors, through an admin-only API and export, plus an admin monitoring page in the web client. There is no teacher-facing analytics UI in this design.

## 2. Non-goals

- No teacher-facing dashboard. Teachers do not see their own agreement statistics.
- No student-facing analytics of any kind. Rule 4 stands: students see only `published_results`.
- No blind-grading mode. Controlling for anchoring bias was considered and deliberately declined; the limitation is recorded in section 9.
- No materialized read-model table. See section 3.
- No changes to the scoring prompt, the scoring model, or the grading workflow itself.

## 3. Approach

PostgreSQL views own the derived truth. NestJS serves the admin page and the export from those views. Python consumes the export for statistics and machine learning.

The alternative — a materialized `assessment_outcomes` table written inside the publish transaction — was rejected. It duplicates truth that already exists in `scoring_results`, `score_revisions`, and `published_results`, and it needs invalidation on unpublish, on republish, and on every new revision. Each of those paths is an opportunity to persist a wrong number, which runs against rule 6. At the data volume this project will reach — hundreds to low thousands of essays — on-demand view queries are fast enough, always fresh, and need no backfill.

Views are created in a plain SQL migration and queried with `$queryRaw`. Prisma's `views` feature is still behind a preview flag and is not worth the risk here.

## 4. Defects that block the metrics

Three problems in the existing code make parts of the analysis impossible. All three must be fixed before the read path is worth building.

### 4.1 AI results have no model provenance

Nothing writes to `ai_model_versions`. `assessments.service.ts:98` reads the table, but no code path ever creates a row, so the table is empty. `worker.py:63` builds `result_payload` without a `modelVersionId`, and `PersistScoringResultDto.modelVersionId` is optional, so every AI scoring result persists with `model_version_id = NULL` and no error.

This violates CLAUDE.md rule 3 — "Every AI result records its `ai_model_versions` reference (model, version, config)" — today, and it makes per-model comparison impossible.

**Fix.** The worker includes a model descriptor — `modelName`, `modelVersion`, `provider`, `taskType`, and the generation `configuration` — in the `result_payload` it already publishes. The server upserts `ai_model_versions` on the existing unique constraint `(model_name, model_version)` inside the same transaction that writes the scoring result, and links the result to it. `PersistScoringResultDto` then requires either a `modelVersionId` or a descriptor whenever `scorerType` is `ai` and `status` is `completed`.

An internal HTTP endpoint called by the worker at startup was considered and rejected. The worker holds no Clerk credentials, so that route would need a shared secret in the environment, a new public endpoint, and its own rate limiting — a new authentication surface for a single write. Carrying the descriptor on the message reuses the transport that already exists, is idempotent through the unique constraint, and introduces no startup ordering dependency between the worker and the server.

A related defect sits in the same path: `assessments.service.ts:72-80` rebuilds the DTO from the queue message field by field and silently discards anything not in that list, so it would drop the descriptor even once the worker sends it. That forwarding must be widened at the same time.

Rows written before this change keep `model_version_id = NULL` and are labelled `pre_provenance` in the view. They cannot be attributed retroactively; the thesis states this rather than guessing.

### 4.2 Scoring latency and token cost are not recorded

`scorer.py:59` writes `processing_metadata` containing only `model_name` and `provider`. There is no duration and no token count, so the cost and latency of AI scoring cannot be measured at all.

**Fix.** Measure wall-clock time around the `generate_content` call and record it as `elapsed_ms`. Read `prompt_token_count`, `candidates_token_count`, and `total_token_count` from `response.usage_metadata`. The stub result path in `_generate_stub_result` emits the same keys with placeholder values so downstream consumers see one uniform shape.

### 4.3 Admin promotion — not a defect

An earlier draft of this spec claimed that nothing assigns `Role.admin` and that an admin-gated analytics API would therefore be unreachable. That was wrong, and it is corrected here rather than quietly deleted, because a plan was written against the false claim before anyone checked.

`apps/server/prisma/promote-to-admin.ts` exports `promoteToAdmin(prisma, clerk, email)`. It updates the user's role in PostgreSQL and mirrors it into Clerk `publicMetadata`. `prisma/seed.ts` calls it, taking the address from `SEED_ADMIN_EMAIL` or the first CLI argument, and `test/promote-to-admin.e2e-spec.ts` covers the success and unknown-email paths. Creating the first admin is:

```bash
cd apps/server && SEED_ADMIN_EMAIL=someone@example.com pnpm db:seed
```

No new script is needed, and adding one would be harmful. `RolesGuard` resolves the role from the database through `UserSyncService`, but `apps/web/lib/clerk-role.ts` and `lib/route-access.ts` read it from the Clerk session claim. A promotion that skipped the Clerk mirror would yield an admin the API trusts and the web client does not.

## 5. New signals to capture

Two signals cannot be reconstructed from existing data and must be captured going forward. A third — divergence between AI feedback text and teacher feedback text — was initially scoped as capture work and then dropped from it: both texts are already persisted append-only, in `scoring_results.feedback` and `score_revisions.final_feedback`, so divergence is computed offline over all existing data. See section 8.

### 5.1 Revision reason codes, tagged in batches

Reasons explain *why* a teacher overrode the AI, which turns a raw override count into named LLM failure modes. That is the qualitative half of the thesis result.

Asking for a reason inline on every revision was rejected: a teacher grading thirty essays clicks through thirty prompts and selects `other` to dismiss them, which produces worse data than no data. Instead, reasons are collected in batches, with the affected revisions visible on screen.

Reasons therefore arrive *after* the revision row exists. Writing them onto `score_revisions` would be an update to an append-only row, against rule 2, so they live in their own append-only table.

```prisma
enum RevisionReason {
  ai_too_generous
  ai_too_harsh
  ai_missed_off_topic
  ai_wrong_criterion
  ai_feedback_inaccurate
  ai_unavailable
  minor_polish
  other
}

enum ReasonSource {
  inline
  batch
}

model RevisionReasonTag {
  id           String           @id @default(uuid()) @db.Uuid
  revisionId   String           @map("revision_id") @db.Uuid
  revision     ScoreRevision    @relation(fields: [revisionId], references: [id])
  reasonCodes  RevisionReason[] @map("reason_codes")
  source       ReasonSource
  batchId      String?          @map("batch_id") @db.Uuid
  note         String?          @db.Text
  taggedBy     String           @map("tagged_by") @db.Uuid
  taggedByUser User             @relation("TeacherReasonTags", fields: [taggedBy], references: [id])
  taggedAt     DateTime         @default(now()) @map("tagged_at") @db.Timestamptz(6)

  @@index([revisionId], map: "revision_reason_tags_revision_id_index")
  @@index([batchId], map: "revision_reason_tags_batch_id_index")
  @@map("revision_reason_tags")
}
```

`ScoreRevision` gains `reasonTags RevisionReasonTag[]` and `User` gains `reasonTags RevisionReasonTag[] @relation("TeacherReasonTags")`. No column is added to `ScoreRevision` itself.

Re-tagging appends a new row and never mutates an existing one. The current tag for a revision is the most recent row for it.

Creating a revision does not require a reason. An optional inline picker stays on the revision form for a teacher who wants to record something specific about one essay; those tags carry `source = inline`.

**Batch prompt trigger.** Untagged revisions by the current teacher on the current assignment are counted after each revision is created. The threshold is proportional to the size of the assignment:

```
threshold = clamp(ceil(0.20 * submissionCount), 3, 15)
```

`submissionCount` is every submission on that assignment across all attempts. The floor of 3 stops the modal firing on the first override in a five-student class, where twenty percent rounds to one. The ceiling of 15 stops a two-hundred-submission assignment accumulating forty untagged revisions before anyone is asked, by which point the reasons are hours stale.

The response to a revision creation returns `untaggedCount`, `threshold`, and `shouldPrompt`, so the client opens the modal without a second request.

A badge appears on the assignment page whenever the untagged count is at least one. The modal opens automatically once the threshold is crossed, and when the teacher leaves the grading view with untagged revisions outstanding. It never blocks publishing — a teacher decision must not be delayed by telemetry.

**Batch modal behaviour.** The modal lists each untagged revision with the student, the per-criterion delta, and the revision note, all pre-checked. The teacher unchecks the ones that do not fit and tags them in a second pass. Applying one reason set to every revision without showing them would flatten a dozen different overrides into uniform noise, which is worse than leaving them untagged.

### 5.2 Review timing

`POST /submissions/:id/review-session`, called by the teacher review page when it mounts. It writes an `audit_events` row with `event_type = 'submission.review_opened'` and metadata `{ sessionId }`.

The write deduplicates against the same actor and submission within thirty minutes so that a page refresh does not inflate the count.

This is an explicit endpoint rather than a side effect on `GET /submissions/:id`, because a GET must stay safe and idempotent, and because a teacher scrolling a submission list would otherwise pollute the data.

Review duration is derived in the view as the interval between a revision and the most recent `review_opened` event by the same teacher on the same submission before it. Nothing extra is stored.

The write is fire-and-forget. It must never fail the page or block rendering. Losing a timing sample is acceptable; rule 6 protects teacher decisions, not telemetry.

## 6. Views

### 6.1 `v_assessment_outcomes`

One row per submission that has at least one revision.

Columns: submission, assignment, class, student, and teacher ids; task type; word count; the AI scores for each of the four criteria plus overall; the teacher final scores; per-criterion delta and absolute delta; `has_ai_baseline`; `revision_count`; `reason_codes`, `reason_source`, and `tag_latency_seconds`; model name and version; timestamps for queued, scoring completed, first review opened, revision created, and published; derived queue latency, scoring latency, and review duration; `elapsed_ms` and token counts; `is_published`; `publish_count`.

The four criterion keys are `task_response`, `coherence_cohesion`, `lexical_resource`, and `grammatical_range_accuracy`, exactly as `apps/ai-service/schemas.py` defines them. `submissions` has no class of its own; the class id comes from `assignments.class_id`.

Model attribution has three distinct states, and they must not be collapsed into one. When a row has no AI baseline at all, model name and version are NULL because there is nothing to attribute. When a baseline exists but predates the fix in 4.1, it carries no `model_version_id` and is marked `pre_provenance`. Otherwise the real model name and version are present. Only the third state may be grouped by model.

Two latencies are exported and they measure different things: `queue_latency_seconds` is wall clock from enqueue to result, including the model call and any waiting, while `scoring_latency_seconds` is `elapsed_ms / 1000` from the scorer itself.

Three rules are encoded once, in SQL, so that no caller can get them wrong. The fragments below give the intended shape and the reasoning behind each one; exact syntax is settled during implementation, where the `UNION ALL` arms need their own parenthesized ordering.

**The live published result** is the most recent `published_results` row for the submission that has not been unpublished:

```sql
WITH live_publication AS (
  SELECT DISTINCT ON (submission_id)
         submission_id, id AS published_result_id, revision_id, published_by, published_at
  FROM published_results
  WHERE unpublished_at IS NULL
  ORDER BY submission_id, published_at DESC
)
```

A republished submission produces a second `published_results` row, so selecting without this filter double-counts.

**Teacher ground truth** is the revision that the live publication references, never `max(revision_number)`. When a submission has revisions but no live publication, the latest revision is used and `is_published` is false, so the analysis can include or exclude it:

```sql
chosen_revision AS (
  SELECT r.* FROM score_revisions r
  JOIN live_publication lp ON lp.revision_id = r.id
  UNION ALL
  SELECT DISTINCT ON (r.submission_id) r.*
  FROM score_revisions r
  WHERE NOT EXISTS (SELECT 1 FROM live_publication lp WHERE lp.submission_id = r.submission_id)
  ORDER BY r.submission_id, r.revision_number DESC
)
```

**The AI baseline for agreement** is the `scoring_results` row referenced by `chosen_revision.base_result_id`. When that column is null the teacher graded before the AI did, or after it failed, and there is no AI score to compare against. Those rows set `has_ai_baseline = false` and every agreement metric filters them out. Including them silently corrupts kappa, because a teacher-authored score would be compared against nothing.

A separate latest completed AI result per submission is joined for timing and cost columns only, independent of whether it was the revision's baseline.

The current reason tag and the review-open timestamp are joined as:

```sql
latest_tag AS (
  SELECT DISTINCT ON (revision_id)
         revision_id, reason_codes, source, note, tagged_at
  FROM revision_reason_tags
  ORDER BY revision_id, tagged_at DESC
)
```

```sql
LEFT JOIN LATERAL (
  SELECT ae.created_at
  FROM audit_events ae
  WHERE ae.event_type = 'submission.review_opened'
    AND ae.entity_id  = cr.submission_id
    AND ae.actor_id   = cr.revised_by
    AND ae.created_at <= cr.created_at
  ORDER BY ae.created_at DESC
  LIMIT 1
) ro ON TRUE
```

Scores are extracted from JSONB with explicit casts, for example `(sr.scores->>'task_response')::numeric`, so that a malformed AI payload fails loudly instead of producing a silent null.

### 6.2 `v_scoring_health`

Per day and per model version: scoring attempts, completions, failures, retries, and the mean and 95th percentile of queue latency and scoring latency. Built from `audit_events` (`submission.queued`, `submission.retry_queued`, `submission.scoring_completed`, `submission.scoring_failed`) joined to `scoring_results`.

### 6.3 `v_teacher_activity`

Per teacher: revision count, publish count, unpublish count, override rate, mean absolute delta, mean review duration, and the proportion of their revisions that carry a reason tag.

## 7. API and admin surface

A new `src/analytics/` module — `analytics.module.ts`, `analytics.service.ts`, `analytics.controller.ts`, and DTOs. The whole controller is gated with `@Roles(Role.admin)` through the existing `RolesGuard`. Authorization is server-side, per the working conventions.

| Endpoint | Purpose |
| --- | --- |
| `GET /analytics/overview` | Headline counts, override rate, mean absolute delta per criterion, scoring failure rate, mean latencies |
| `GET /analytics/scoring-health?from&to` | Time series for the monitoring page |
| `GET /analytics/export?format=csv\|jsonl&from&to` | Streams `v_assessment_outcomes` |

The export is pseudonymous. It carries the student UUID and nothing else identifying — no email, no display name. Essay text is included only when the caller passes `include_essays=true`, because it is student-authored content and the CatBoost training set is the only reason to move it.

Every export writes an `audit_events` row with `event_type = 'analytics.exported'` recording the requested window, the format, and whether essays were included, so that a dataset used in the thesis can be traced back to the exact query that produced it.

Responses stream rather than buffer, so a large export does not hold the whole result set in memory.

Two new endpoints belong to the capture side rather than the analytics module:

| Endpoint | Purpose |
| --- | --- |
| `GET /assignments/:id/revisions/untagged` | Populates the batch modal: untagged revisions by the caller on that assignment, each with student, per-criterion delta, and revision note |
| `POST /revision-reasons/batch` | `{ revisionIds[], reasonCodes[], note? }` |

The batch write is a single transaction: N tag rows sharing one generated `batchId`, plus one `audit_events` row with `event_type = 'revision_reasons.tagged'` and metadata `{ batchId, count }`. It rejects the whole request if any `revisionId` belongs to an assignment the caller does not own.

There is no idempotency key. An earlier draft listed one, which would have been dead weight: the server runs `ValidationPipe({ whitelist: true })` in `main.ts`, so an unrecognised field is stripped in silence and a client sending the key would get no protection and no error. Making it real needs a unique column and constraint, and the payoff does not justify them — tagging is append-only and the view takes the most recent tag per revision, so a double submit writes a visibly duplicated row (same reason codes, different `batchId`, seconds apart) and changes no metric.

**Web client.** `apps/web/app/admin/page.tsx` for the overview and `apps/web/app/admin/scoring/page.tsx` for scoring health, both gated server-side on the role returned by `/users/me`. Charts use `recharts`, the first charting dependency in the web app, chosen for proper time-series rendering of queue latency and failure rate.

## 8. Python analysis

`apps/ai-service/analysis/` is a research folder, not part of the running service. Nothing in `main.py` or `worker.py` imports it.

- `load.py` — reads the exported CSV, or connects to a read-only database URL.
- `agreement.py` — quadratic weighted kappa via `cohen_kappa_score(weights='quadratic')`, with half-band scores mapped to integer classes by multiplying by two; plus exact agreement, agreement within half a band, mean absolute error, and Spearman correlation. Per criterion and overall. Reads only rows where `has_ai_baseline` is true.
- `feedback_divergence.py` — similarity between AI and teacher feedback: token-level Jaccard and normalized Levenshtein on `summary`, set overlap on `strengths` and `improvements`. Runs over all historical data, since both texts were already stored.
- `catboost_eval.py` — trains CatBoost per criterion and compares it against the LLM baseline on the same held-out set.
- `report.py` — emits the tables used in the thesis.

**Splitting.** Train and test split by assignment, not by row. A student may submit several attempts of the same essay on the same prompt, so a random row split leaks near-duplicate text across the boundary and inflates the CatBoost result.

New dependencies — `pandas`, `scikit-learn`, `catboost`, and a Levenshtein implementation — go in a separate `requirements-analysis.txt`. The deployed worker image continues to install only `requirements.txt`.

## 9. Data quality caveats

These are recorded in the data so the thesis can state them rather than hide them.

- **Retrospective reasons.** Batch-tagged reasons are given after the fact and are weaker evidence than reasons given at the moment of the decision. The view exports `reason_source` and `tag_latency_seconds` so the analysis can filter or weight them.
- **Anchoring is uncontrolled.** When `base_result_id` is not null, the teacher saw the AI score before entering their own. Agreement measured on those rows is agreement under anchoring, not independent agreement. The design does not attempt to correct for it; the thesis reports it as a limitation.
- **Pre-provenance rows.** AI results written before the fix in 4.1 carry no model version and are excluded from per-model comparison. They are distinct from rows with no AI baseline at all, which are excluded from every AI-versus-teacher metric for a different reason.
- **Feedback text is not in the export.** The `v_assessment_outcomes` column list carries scores and timings, not feedback prose. Feedback divergence therefore reads `scoring_results.feedback` and `score_revisions.final_feedback` directly rather than going through the export.
- **Untagged revisions.** An empty tag set means the reason was not captured, not that there was no reason. The two are never conflated.

## 10. Error handling

Views are read-only, so nothing on the analytics path can corrupt grading data. The analytics module performs no writes other than the `analytics.exported` audit row.

The `review-session` write is fire-and-forget and never fails the page. Batch tagging is one transaction and rejects any revision outside the caller's assignments. The export streams.

A malformed `scores` JSONB payload surfaces as a cast error in the view rather than a silent null, consistent with rule 6 — reject rather than return something wrong.

## 11. Testing

Vitest, in `apps/server`:

- Threshold clamp arithmetic at the boundaries: 5 submissions clamps up to 3, 200 clamps down to 15, 40 gives 8.
- Batch tagging rejects a `revisionId` from another teacher's assignment, and rejects the whole batch rather than partially applying it.
- `review_opened` deduplication inside and outside the thirty-minute window.
- `PersistScoringResultDto` rejects a completed AI result with no `modelVersionId`.

The view logic is where bugs will hide, so it gets a seeded fixture set asserted row by row, covering: a republished submission, an unpublished-then-republished submission, a teacher-first revision with a null base result, a submission with multiple revisions, and a failed scoring attempt followed by a successful retry.

Pytest, in `apps/ai-service`: `agreement.py` against a small fixture with hand-computed kappa, including the case where every `has_ai_baseline` row is filtered out.

That fixture must also pin `labels=` explicitly. scikit-learn builds quadratic weights from label *indices*, not from band values, so an absent intermediate band silently shrinks the distance between the bands either side of it and inflates kappa. On the reference fixture the difference is 0.7 with explicit labels against roughly 0.7857 without them.

`pnpm test` and `pnpm lint` must pass in `apps/server` before the work is considered done.

## 12. Implementation order

Capture first. Data not collected is data lost, and the read path can be built at any time against whatever exists.

1. Model provenance: worker sends a model descriptor, server upserts `ai_model_versions` (4.1).
2. `scorer.py` records `elapsed_ms` and token counts (4.2).
3. `review-session` endpoint, deduplication, and the client call on the review page (5.2).
4. `RevisionReasonTag` table, batch endpoints, and the batch modal (5.1).
5. The three views (6).
6. The `analytics` module and its endpoints (7).
7. Admin pages with `recharts` (7).
8. `apps/ai-service/analysis/` (8), with its dependencies and source kept out of the deployed image.

Admin promotion is not a step; it already exists (4.3). Run it once before the admin pages in step 7 are reachable.
