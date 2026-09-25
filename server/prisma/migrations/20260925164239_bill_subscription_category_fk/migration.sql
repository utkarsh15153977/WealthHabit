-- AlterTable
ALTER TABLE "bills" DROP COLUMN "category",
ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "category",
ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "bills_categoryId_idx" ON "bills"("categoryId");

-- CreateIndex
CREATE INDEX "subscriptions_categoryId_idx" ON "subscriptions"("categoryId");

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

