-- AlterEnum
ALTER TYPE "SubmissionStatus" ADD VALUE 'abuse';

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN     "abuse_reason" TEXT,
ADD COLUMN     "abuse_details" JSONB;
