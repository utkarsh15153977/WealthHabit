/*
  Warnings:

  - Made the column `startDate` on table `challenges` required. This step will fail if there are existing NULL values in that column.
  - Made the column `endDate` on table `challenges` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "ChallengeType" AS ENUM ('HABIT_COMPLETION');

-- AlterTable
ALTER TABLE "challenges" ADD COLUMN     "type" "ChallengeType" NOT NULL DEFAULT 'HABIT_COMPLETION',
ALTER COLUMN "startDate" SET NOT NULL,
ALTER COLUMN "endDate" SET NOT NULL;

-- CreateTable
CREATE TABLE "challenge_habit_requirements" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" "Frequency" NOT NULL,
    "target" INTEGER NOT NULL DEFAULT 1,
    "unit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_habit_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_participant_habits" (
    "id" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_participant_habits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "challenge_habit_requirements_challengeId_idx" ON "challenge_habit_requirements"("challengeId");

-- CreateIndex
CREATE INDEX "challenge_participant_habits_habitId_idx" ON "challenge_participant_habits"("habitId");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_participant_habits_participantId_requirementId_key" ON "challenge_participant_habits"("participantId", "requirementId");

-- AddForeignKey
ALTER TABLE "challenge_habit_requirements" ADD CONSTRAINT "challenge_habit_requirements_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participant_habits" ADD CONSTRAINT "challenge_participant_habits_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "challenge_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participant_habits" ADD CONSTRAINT "challenge_participant_habits_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "challenge_habit_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participant_habits" ADD CONSTRAINT "challenge_participant_habits_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "financial_habits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
