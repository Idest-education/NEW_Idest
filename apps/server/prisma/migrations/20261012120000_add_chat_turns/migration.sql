-- CreateEnum
CREATE TYPE "ChatTurnStatus" AS ENUM ('pending', 'answered', 'failed');

-- CreateTable
CREATE TABLE "chat_turns" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "ChatTurnStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMPTZ(6),

    CONSTRAINT "chat_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_turns_submission_index" ON "chat_turns"("submission_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
