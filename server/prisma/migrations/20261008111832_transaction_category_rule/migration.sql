-- CreateTable
CREATE TABLE "transaction_category_rules" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "normalizedMerchant" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_category_rules_userId_idx" ON "transaction_category_rules"("userId");

-- CreateIndex
CREATE INDEX "transaction_category_rules_categoryId_idx" ON "transaction_category_rules"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_category_rules_userId_normalizedMerchant_key" ON "transaction_category_rules"("userId", "normalizedMerchant");

-- AddForeignKey
ALTER TABLE "transaction_category_rules" ADD CONSTRAINT "transaction_category_rules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_category_rules" ADD CONSTRAINT "transaction_category_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
