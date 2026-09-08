-- CreateTable
CREATE TABLE "FinancePolicy" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accounts" TEXT NOT NULL DEFAULT '{}',
    "vatRate" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "corporateTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 0.09,
    "corporateTaxBand" DOUBLE PRECISION NOT NULL DEFAULT 375000,
    "sbrRevenueCap" DOUBLE PRECISION NOT NULL DEFAULT 3000000,
    "lossReliefCap" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "filingMonths" DOUBLE PRECISION NOT NULL DEFAULT 9,
    "chequeStaleDays" DOUBLE PRECISION NOT NULL DEFAULT 180,
    "defaultRetentionPercent" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "expiryWarningDays" DOUBLE PRECISION NOT NULL DEFAULT 60,
    "pageSize" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "notes" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancePolicy_companyId_key" ON "FinancePolicy"("companyId");

-- AddForeignKey
ALTER TABLE "FinancePolicy" ADD CONSTRAINT "FinancePolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

