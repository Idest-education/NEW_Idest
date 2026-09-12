-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('draft', 'active', 'closed', 'archived');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('task_1', 'task_2');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('submitted', 'queued', 'scoring', 'scored', 'under_review', 'published', 'failed');

-- CreateEnum
CREATE TYPE "ScorerType" AS ENUM ('ai', 'teacher');

-- CreateEnum
CREATE TYPE "ScoringStatus" AS ENUM ('completed', 'failed');

-- CreateEnum
CREATE TYPE "ModelStatus" AS ENUM ('experimental', 'active', 'retired');

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "task_prompt" TEXT NOT NULL,
    "task_type" "TaskType" NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'draft',
    "due_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "essay_text" TEXT NOT NULL,
    "word_count" INTEGER NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'submitted',
    "idempotency_key" TEXT,
    "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_model_versions" (
    "id" UUID NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "model_version" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "task_type" VARCHAR(20) NOT NULL,
    "configuration" JSONB NOT NULL,
    "status" "ModelStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_results" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "scorer_id" UUID,
    "model_version_id" UUID,
    "scorer_type" "ScorerType" NOT NULL,
    "status" "ScoringStatus" NOT NULL DEFAULT 'completed',
    "scores" JSONB NOT NULL,
    "feedback" JSONB NOT NULL,
    "raw_output" JSONB,
    "processing_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scoring_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_revisions" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "base_result_id" UUID NOT NULL,
    "revised_by" UUID NOT NULL,
    "revision_number" INTEGER NOT NULL,
    "changes" JSONB NOT NULL,
    "final_scores" JSONB NOT NULL,
    "final_feedback" JSONB NOT NULL,
    "revision_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "published_results" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "published_by" UUID NOT NULL,
    "final_scores" JSONB NOT NULL,
    "final_feedback" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unpublished_at" TIMESTAMPTZ(6),

    CONSTRAINT "published_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assignments_teacher_id_index" ON "assignments"("teacher_id");
CREATE INDEX "assignments_status_index" ON "assignments"("status");
CREATE INDEX "assignments_due_at_index" ON "assignments"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_assignment_id_student_id_attempt_number_key" ON "submissions"("assignment_id", "student_id", "attempt_number");
CREATE INDEX "submissions_assignment_id_index" ON "submissions"("assignment_id");
CREATE INDEX "submissions_student_id_index" ON "submissions"("student_id");
CREATE INDEX "submissions_status_index" ON "submissions"("status");
CREATE INDEX "submissions_submitted_at_index" ON "submissions"("submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_model_versions_model_name_model_version_key" ON "ai_model_versions"("model_name", "model_version");

-- CreateIndex
CREATE INDEX "scoring_results_submission_id_index" ON "scoring_results"("submission_id");
CREATE INDEX "scoring_results_scorer_id_index" ON "scoring_results"("scorer_id");
CREATE INDEX "scoring_results_model_version_id_index" ON "scoring_results"("model_version_id");
CREATE INDEX "scoring_results_created_at_index" ON "scoring_results"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "score_revisions_submission_id_revision_number_key" ON "score_revisions"("submission_id", "revision_number");
CREATE INDEX "score_revisions_submission_id_index" ON "score_revisions"("submission_id");
CREATE INDEX "score_revisions_revised_by_index" ON "score_revisions"("revised_by");
CREATE INDEX "score_revisions_base_result_id_index" ON "score_revisions"("base_result_id");

-- CreateIndex
CREATE INDEX "published_results_submission_id_index" ON "published_results"("submission_id");
CREATE INDEX "published_results_published_by_index" ON "published_results"("published_by");
CREATE INDEX "published_results_published_at_index" ON "published_results"("published_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_index" ON "audit_events"("actor_id");
CREATE INDEX "audit_events_entity_index" ON "audit_events"("entity_type", "entity_id");
CREATE INDEX "audit_events_event_type_index" ON "audit_events"("event_type");
CREATE INDEX "audit_events_created_at_index" ON "audit_events"("created_at");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_results" ADD CONSTRAINT "scoring_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_results" ADD CONSTRAINT "scoring_results_scorer_id_fkey" FOREIGN KEY ("scorer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_results" ADD CONSTRAINT "scoring_results_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "ai_model_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_revisions" ADD CONSTRAINT "score_revisions_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_revisions" ADD CONSTRAINT "score_revisions_base_result_id_fkey" FOREIGN KEY ("base_result_id") REFERENCES "scoring_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_revisions" ADD CONSTRAINT "score_revisions_revised_by_fkey" FOREIGN KEY ("revised_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_results" ADD CONSTRAINT "published_results_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_results" ADD CONSTRAINT "published_results_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "score_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "published_results" ADD CONSTRAINT "published_results_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
