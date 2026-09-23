/*
  Warnings:

  - Added the required column `tokenFamilyId` to the `sessions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "previousRefreshTokenHash" TEXT,
ADD COLUMN     "tokenFamilyId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "sessions_tokenFamilyId_idx" ON "sessions"("tokenFamilyId");
