-- CreateEnum
CREATE TYPE "ClassStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "RedoStatus" AS ENUM ('open', 'resolved', 'cancelled');

-- DropForeignKey
ALTER TABLE "score_revisions" DROP CONSTRAINT "score_revisions_base_result_id_fkey";

-- AlterTable
ALTER TABLE "assignments" ADD COLUMN     "class_id" UUID,
ADD COLUMN     "highlighted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "score_revisions" ALTER COLUMN "base_result_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "classes" (
    "id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "status" "ClassStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_members" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "class_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_links" (
    "id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "label" VARCHAR(160),
    "max_uses" INTEGER,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redo_requests" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RedoStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "redo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "classes_teacher_id_index" ON "classes"("teacher_id");

-- CreateIndex
CREATE INDEX "classes_status_index" ON "classes"("status");

-- CreateIndex
CREATE INDEX "class_members_class_id_index" ON "class_members"("class_id");

-- CreateIndex
CREATE INDEX "class_members_student_id_index" ON "class_members"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_members_class_id_student_id_key" ON "class_members"("class_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_links_token_key" ON "invite_links"("token");

-- CreateIndex
CREATE INDEX "invite_links_class_id_index" ON "invite_links"("class_id");

-- CreateIndex
CREATE INDEX "invite_links_token_index" ON "invite_links"("token");

-- CreateIndex
CREATE INDEX "redo_requests_submission_id_index" ON "redo_requests"("submission_id");

-- CreateIndex
CREATE INDEX "redo_requests_status_index" ON "redo_requests"("status");

-- CreateIndex
CREATE INDEX "assignments_class_id_index" ON "assignments"("class_id");

-- CreateIndex
CREATE INDEX "assignments_highlighted_index" ON "assignments"("highlighted");

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_revisions" ADD CONSTRAINT "score_revisions_base_result_id_fkey" FOREIGN KEY ("base_result_id") REFERENCES "scoring_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_members" ADD CONSTRAINT "class_members_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_members" ADD CONSTRAINT "class_members_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redo_requests" ADD CONSTRAINT "redo_requests_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redo_requests" ADD CONSTRAINT "redo_requests_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
