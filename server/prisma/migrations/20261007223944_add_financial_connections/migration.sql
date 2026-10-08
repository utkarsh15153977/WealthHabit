-- Phase 6B: financial connection foundation (additive only).
--
-- 1. New enums for provider, connection status, account type and the
--    transaction origin flag that separates manual rows from imported ones.
-- 2. transactions gains nullable provenance columns; `source` is NOT NULL
--    with DEFAULT 'MANUAL' so every existing row (and every future manual
--    insert) keeps its current meaning without a backfill.
-- 3. financial_connections / financial_accounts are new tables. Disconnecting
--    or deleting them must never delete user transactions: the transactions
--    -> financial_accounts foreign key is ON DELETE SET NULL, mirroring the
--    existing recurringTransactionId behaviour.
-- 4. Unique constraints on (financialAccountId, externalTransactionId) and
--    (userId, dedupKey) are the future import idempotency keys. Both columns
--    are NULL on every existing row, and PostgreSQL treats NULLs as distinct,
--    so this migration cannot reject existing data.
--
-- No existing table, column, index or row is dropped, altered in semantics,
-- or backfilled here.

-- CreateEnum
CREATE TYPE "FinancialConnectionProvider" AS ENUM ('MOCK', 'ACCOUNT_AGGREGATOR', 'BANK');

-- CreateEnum
CREATE TYPE "FinancialConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'REVOKED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "FinancialAccountType" AS ENUM ('SAVINGS', 'CURRENT', 'DEBIT_CARD', 'CREDIT_CARD', 'UPI_LINKED');

-- CreateEnum
CREATE TYPE "TransactionSource" AS ENUM ('MANUAL', 'IMPORTED');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "dedupKey" TEXT,
ADD COLUMN     "externalTransactionId" TEXT,
ADD COLUMN     "financialAccountId" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "merchant" TEXT,
ADD COLUMN     "paymentChannel" TEXT,
ADD COLUMN     "source" "TransactionSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "financial_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "FinancialConnectionProvider" NOT NULL,
    "status" "FinancialConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "institutionName" TEXT,
    "consentGivenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "providerMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "type" "FinancialAccountType" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "institutionName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_connections_userId_idx" ON "financial_connections"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_connections_userId_provider_key" ON "financial_connections"("userId", "provider");

-- CreateIndex
CREATE INDEX "financial_accounts_userId_idx" ON "financial_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_connectionId_externalAccountId_key" ON "financial_accounts"("connectionId", "externalAccountId");

-- CreateIndex
CREATE INDEX "transactions_userId_source_idx" ON "transactions"("userId", "source");

-- CreateIndex
CREATE INDEX "transactions_financialAccountId_idx" ON "transactions"("financialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_financialAccountId_externalTransactionId_key" ON "transactions"("financialAccountId", "externalTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_userId_dedupKey_key" ON "transactions"("userId", "dedupKey");

-- AddForeignKey
ALTER TABLE "financial_connections" ADD CONSTRAINT "financial_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "financial_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
