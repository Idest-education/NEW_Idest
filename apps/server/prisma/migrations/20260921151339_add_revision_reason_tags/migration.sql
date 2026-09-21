-- CreateEnum
CREATE TYPE "RevisionReason" AS ENUM ('ai_too_generous', 'ai_too_harsh', 'ai_missed_off_topic', 'ai_wrong_criterion', 'ai_feedback_inaccurate', 'ai_unavailable', 'minor_polish', 'other');

-- CreateEnum
CREATE TYPE "ReasonSource" AS ENUM ('inline', 'batch');

-- CreateTable
CREATE TABLE "revision_reason_tags" (
    "id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "reason_codes" "RevisionReason"[],
    "source" "ReasonSource" NOT NULL,
    "batch_id" UUID,
    "note" TEXT,
    "tagged_by" UUID NOT NULL,
    "tagged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revision_reason_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "revision_reason_tags_revision_id_index" ON "revision_reason_tags"("revision_id");

-- CreateIndex
CREATE INDEX "revision_reason_tags_batch_id_index" ON "revision_reason_tags"("batch_id");

-- AddForeignKey
ALTER TABLE "revision_reason_tags" ADD CONSTRAINT "revision_reason_tags_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "score_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revision_reason_tags" ADD CONSTRAINT "revision_reason_tags_tagged_by_fkey" FOREIGN KEY ("tagged_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
