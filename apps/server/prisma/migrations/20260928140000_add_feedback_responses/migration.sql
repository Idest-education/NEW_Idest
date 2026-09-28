-- AlterTable
ALTER TABLE "users" ADD COLUMN     "feedback_prompt_dismissed_count" INTEGER;

-- CreateTable
CREATE TABLE "feedback_responses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "instrument_version" INTEGER NOT NULL,
    "answers" JSONB NOT NULL,
    "usage" JSONB NOT NULL,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feedback_responses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "feedback_responses_role_check" CHECK ("role" IN ('teacher', 'student'))
);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_responses_user_id_key" ON "feedback_responses"("user_id");

-- AddForeignKey
ALTER TABLE "feedback_responses" ADD CONSTRAINT "feedback_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
