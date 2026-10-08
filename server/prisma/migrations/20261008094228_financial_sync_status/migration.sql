-- AlterTable
ALTER TABLE "financial_accounts" ADD COLUMN     "lastSyncError" TEXT,
ADD COLUMN     "lastSyncSummary" JSONB;
