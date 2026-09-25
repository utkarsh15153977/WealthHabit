-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('BUDGET_THRESHOLD', 'BILL_UPCOMING', 'BILL_OVERDUE', 'SUBSCRIPTION_UPCOMING', 'RECURRING_TRANSACTION_UPCOMING');

-- DropIndex
DROP INDEX "notifications_createdAt_idx";

-- DropIndex
DROP INDEX "notifications_isRead_idx";

-- DropIndex
DROP INDEX "notifications_userId_idx";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupKey" TEXT,
ADD COLUMN     "metadata" JSONB,
DROP COLUMN "type",
ADD COLUMN     "type" "NotificationType" NOT NULL;

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "notifications_userId_dedupKey_key" ON "notifications"("userId", "dedupKey");
