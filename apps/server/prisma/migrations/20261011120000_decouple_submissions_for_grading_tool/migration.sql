-- Grading-tool pivot: a submission no longer needs an assignment or a student.
-- See docs/superpowers/specs/2026-10-11-grading-tool-pivot-design.md.

-- CreateEnum
CREATE TYPE "SubmissionSource" AS ENUM ('assignment', 'public', 'batch');
CREATE TYPE "IntakeKind" AS ENUM ('image', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv');
CREATE TYPE "IntakeStatus" AS ENUM ('pending', 'extracting', 'extracted', 'failed');

-- CreateTable
CREATE TABLE "grading_batches" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "task_prompt" TEXT NOT NULL,
    "task_image_url" TEXT,
    "task_image_public_id" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grading_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "grading_batches_teacher_id_index" ON "grading_batches"("teacher_id");
ALTER TABLE "grading_batches" ADD CONSTRAINT "grading_batches_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "intake_files" (
    "id" UUID NOT NULL,
    "owner_id" UUID,
    "batch_id" UUID,
    "kind" "IntakeKind" NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content" BYTEA[],
    "mime_types" TEXT[],
    "size_bytes" INTEGER NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'pending',
    "extraction" JSONB,
    "error" TEXT,
    "client_hash" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_files_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "intake_files_batch_id_index" ON "intake_files"("batch_id");
CREATE INDEX "intake_files_client_hash_index" ON "intake_files"("client_hash", "created_at");
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "intake_files" ADD CONSTRAINT "intake_files_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "grading_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: owner columns become optional, task fields are snapshotted
ALTER TABLE "submissions"
    ALTER COLUMN "assignment_id" DROP NOT NULL,
    ALTER COLUMN "student_id" DROP NOT NULL,
    ALTER COLUMN "attempt_number" DROP NOT NULL,
    ADD COLUMN "source" "SubmissionSource" NOT NULL DEFAULT 'assignment',
    ADD COLUMN "owner_id" UUID,
    ADD COLUMN "batch_id" UUID,
    ADD COLUMN "source_file_id" UUID,
    ADD COLUMN "source_ref" JSONB,
    ADD COLUMN "client_hash" VARCHAR(64),
    ADD COLUMN "task_type" "TaskType",
    ADD COLUMN "task_prompt" TEXT,
    ADD COLUMN "task_image_url" TEXT;

-- Backfill the snapshot from each submission's assignment
UPDATE "submissions" s
SET "task_type" = a."task_type",
    "task_prompt" = a."task_prompt",
    "task_image_url" = a."task_image_url"
FROM "assignments" a
WHERE a."id" = s."assignment_id";

ALTER TABLE "submissions"
    ALTER COLUMN "task_type" SET NOT NULL,
    ALTER COLUMN "task_prompt" SET NOT NULL;

ALTER TABLE "submissions" ADD CONSTRAINT "submissions_source_owner_check" CHECK (
    ("source" <> 'assignment' OR ("assignment_id" IS NOT NULL AND "student_id" IS NOT NULL AND "attempt_number" IS NOT NULL))
    AND ("source" <> 'batch' OR ("batch_id" IS NOT NULL AND "owner_id" IS NOT NULL))
);

CREATE INDEX "submissions_owner_id_index" ON "submissions"("owner_id");
CREATE INDEX "submissions_batch_id_index" ON "submissions"("batch_id");
CREATE INDEX "submissions_client_hash_index" ON "submissions"("client_hash", "submitted_at");
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "grading_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_source_file_id_fkey" FOREIGN KEY ("source_file_id") REFERENCES "intake_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Analytics: keep submissions that have no assignment. Same columns and types,
-- so dependent views stay valid under CREATE OR REPLACE.
CREATE OR REPLACE VIEW v_assessment_outcomes AS
WITH live_publication AS (
  SELECT DISTINCT ON (submission_id)
         submission_id,
         id          AS published_result_id,
         revision_id,
         published_by,
         published_at
  FROM published_results
  WHERE unpublished_at IS NULL
  ORDER BY submission_id, published_at DESC
),
publish_counts AS (
  SELECT submission_id, count(*)::int AS publish_count
  FROM published_results
  GROUP BY submission_id
),
revision_counts AS (
  SELECT submission_id, count(*)::int AS revision_count
  FROM score_revisions
  GROUP BY submission_id
),
chosen_revision AS (
  SELECT r.*
  FROM score_revisions r
  JOIN live_publication lp ON lp.revision_id = r.id
  UNION ALL
  (
    SELECT DISTINCT ON (r.submission_id) r.*
    FROM score_revisions r
    WHERE NOT EXISTS (
      SELECT 1 FROM live_publication lp WHERE lp.submission_id = r.submission_id
    )
    ORDER BY r.submission_id, r.revision_number DESC
  )
),
latest_tag AS (
  SELECT DISTINCT ON (revision_id)
         revision_id, reason_codes, source, note, tagged_at
  FROM revision_reason_tags
  ORDER BY revision_id, tagged_at DESC
)
SELECT
  cr.submission_id,
  s.assignment_id,
  a.class_id,
  s.student_id,
  cr.revised_by                                            AS teacher_id,
  s.task_type,
  s.attempt_number,
  s.word_count,
  s.submitted_at,

  cr.id                                                    AS revision_id,
  cr.revision_number,
  cr.base_result_id                                        AS ai_result_id,
  lar.id                                                   AS latest_ai_result_id,
  lp.published_result_id,

  -- AI baseline: the scoring_results row this revision was written against.
  (bsr.scores ->> 'task_response')::numeric                AS ai_task_response,
  (bsr.scores ->> 'coherence_cohesion')::numeric           AS ai_coherence_cohesion,
  (bsr.scores ->> 'lexical_resource')::numeric             AS ai_lexical_resource,
  (bsr.scores ->> 'grammatical_range_accuracy')::numeric   AS ai_grammatical_range_accuracy,
  (bsr.scores ->> 'overall')::numeric                      AS ai_overall,

  (cr.final_scores ->> 'task_response')::numeric              AS teacher_task_response,
  (cr.final_scores ->> 'coherence_cohesion')::numeric         AS teacher_coherence_cohesion,
  (cr.final_scores ->> 'lexical_resource')::numeric           AS teacher_lexical_resource,
  (cr.final_scores ->> 'grammatical_range_accuracy')::numeric AS teacher_grammatical_range_accuracy,
  (cr.final_scores ->> 'overall')::numeric                    AS teacher_overall,

  -- NULL exactly when has_ai_baseline is false, because bsr is then NULL.
  (cr.final_scores ->> 'task_response')::numeric
    - (bsr.scores ->> 'task_response')::numeric              AS delta_task_response,
  (cr.final_scores ->> 'coherence_cohesion')::numeric
    - (bsr.scores ->> 'coherence_cohesion')::numeric         AS delta_coherence_cohesion,
  (cr.final_scores ->> 'lexical_resource')::numeric
    - (bsr.scores ->> 'lexical_resource')::numeric           AS delta_lexical_resource,
  (cr.final_scores ->> 'grammatical_range_accuracy')::numeric
    - (bsr.scores ->> 'grammatical_range_accuracy')::numeric AS delta_grammatical_range_accuracy,
  (cr.final_scores ->> 'overall')::numeric
    - (bsr.scores ->> 'overall')::numeric                    AS delta_overall,

  abs((cr.final_scores ->> 'task_response')::numeric
    - (bsr.scores ->> 'task_response')::numeric)              AS abs_delta_task_response,
  abs((cr.final_scores ->> 'coherence_cohesion')::numeric
    - (bsr.scores ->> 'coherence_cohesion')::numeric)         AS abs_delta_coherence_cohesion,
  abs((cr.final_scores ->> 'lexical_resource')::numeric
    - (bsr.scores ->> 'lexical_resource')::numeric)           AS abs_delta_lexical_resource,
  abs((cr.final_scores ->> 'grammatical_range_accuracy')::numeric
    - (bsr.scores ->> 'grammatical_range_accuracy')::numeric) AS abs_delta_grammatical_range_accuracy,
  abs((cr.final_scores ->> 'overall')::numeric
    - (bsr.scores ->> 'overall')::numeric)                    AS abs_delta_overall,

  (cr.base_result_id IS NOT NULL)                          AS has_ai_baseline,

  -- NULL, not false, when there is no baseline: "no AI score to disagree with"
  -- and "agreed with the AI" are never conflated.
  CASE WHEN cr.base_result_id IS NULL THEN NULL ELSE (
       (cr.final_scores ->> 'task_response')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'task_response')::numeric
    OR (cr.final_scores ->> 'coherence_cohesion')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'coherence_cohesion')::numeric
    OR (cr.final_scores ->> 'lexical_resource')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'lexical_resource')::numeric
    OR (cr.final_scores ->> 'grammatical_range_accuracy')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'grammatical_range_accuracy')::numeric
    OR (cr.final_scores ->> 'overall')::numeric
         IS DISTINCT FROM (bsr.scores ->> 'overall')::numeric
  ) END                                                    AS is_override,

  COALESCE(rc.revision_count, 0)                           AS revision_count,

  lt.reason_codes,
  lt.source                                                AS reason_source,
  lt.note                                                  AS reason_note,
  EXTRACT(EPOCH FROM (lt.tagged_at - cr.created_at))::numeric AS tag_latency_seconds,

  -- 'pre_provenance' marks an AI result written before the worker started
  -- sending a model descriptor. Those rows cannot be attributed retroactively
  -- and are excluded from per-model comparison. NULL means there was no AI
  -- result at all, which is a different thing.
  CASE WHEN cr.base_result_id IS NULL THEN NULL
       ELSE COALESCE(bmv.model_name, 'pre_provenance') END     AS model_name,
  CASE WHEN cr.base_result_id IS NULL THEN NULL
       ELSE COALESCE(bmv.model_version, 'pre_provenance') END  AS model_version,

  q.created_at                                             AS queued_at,
  lar.created_at                                           AS scoring_completed_at,
  ro.created_at                                            AS review_opened_at,
  cr.created_at                                            AS revision_created_at,
  lp.published_at,

  -- Wall clock from the enqueue to the result landing; it includes the model
  -- call. scoring_latency_seconds is the model call on its own.
  EXTRACT(EPOCH FROM (lar.created_at - q.created_at))::numeric AS queue_latency_seconds,
  ((lar.processing_metadata ->> 'elapsed_ms')::numeric / 1000.0) AS scoring_latency_seconds,
  EXTRACT(EPOCH FROM (cr.created_at - ro.created_at))::numeric   AS review_duration_seconds,

  (lar.processing_metadata ->> 'elapsed_ms')::int          AS elapsed_ms,
  (lar.processing_metadata ->> 'prompt_tokens')::int       AS prompt_tokens,
  (lar.processing_metadata ->> 'completion_tokens')::int   AS completion_tokens,
  (lar.processing_metadata ->> 'total_tokens')::int        AS total_tokens,

  (lp.submission_id IS NOT NULL)                           AS is_published,
  COALESCE(pc.publish_count, 0)                            AS publish_count,

  -- Student-authored content. The export carries it only behind
  -- include_essays=true; no student email or display name is in this view.
  s.essay_text
FROM chosen_revision cr
JOIN submissions s              ON s.id = cr.submission_id
LEFT JOIN assignments a         ON a.id = s.assignment_id
LEFT JOIN scoring_results bsr   ON bsr.id = cr.base_result_id
LEFT JOIN ai_model_versions bmv ON bmv.id = bsr.model_version_id
LEFT JOIN live_publication lp   ON lp.submission_id = cr.submission_id
LEFT JOIN publish_counts pc     ON pc.submission_id = cr.submission_id
LEFT JOIN revision_counts rc    ON rc.submission_id = cr.submission_id
LEFT JOIN latest_tag lt         ON lt.revision_id = cr.id
-- The latest completed AI result, for timing and cost only. Independent of
-- whether it happened to be this revision's baseline.
LEFT JOIN LATERAL (
  SELECT sr.id, sr.created_at, sr.processing_metadata
  FROM scoring_results sr
  WHERE sr.submission_id = cr.submission_id
    AND sr.scorer_type = 'ai'
    AND sr.status = 'completed'
  ORDER BY sr.created_at DESC
  LIMIT 1
) lar ON TRUE
-- The queue event that actually produced that result. After a retry this is
-- the retry event, not the original enqueue.
LEFT JOIN LATERAL (
  SELECT ae.created_at
  FROM audit_events ae
  WHERE ae.event_type IN ('submission.queued', 'submission.retry_queued')
    AND ae.entity_id = cr.submission_id
    AND (lar.created_at IS NULL OR ae.created_at <= lar.created_at)
  ORDER BY ae.created_at DESC
  LIMIT 1
) q ON TRUE
LEFT JOIN LATERAL (
  SELECT ae.created_at
  FROM audit_events ae
  WHERE ae.event_type = 'submission.review_opened'
    AND ae.entity_id  = cr.submission_id
    AND ae.actor_id   = cr.revised_by
    AND ae.created_at <= cr.created_at
  ORDER BY ae.created_at DESC
  LIMIT 1
) ro ON TRUE;
