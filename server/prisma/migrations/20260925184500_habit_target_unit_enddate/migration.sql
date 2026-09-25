-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'HABIT_REMINDER';

-- AlterTable
ALTER TABLE "financial_habits" ADD COLUMN     "endDate" TIMESTAMP(3),
ADD COLUMN     "target" DECIMAL(15,2),
ADD COLUMN     "unit" TEXT;
