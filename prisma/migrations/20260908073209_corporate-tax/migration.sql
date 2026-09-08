-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "corporateTaxTRN" TEXT;

-- CreateTable
CREATE TABLE "CorporateTaxReturn" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "sbrElected" BOOLEAN NOT NULL DEFAULT false,
    "lossesBroughtForward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "filedOn" TIMESTAMP(3),
    "filedRef" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateTaxReturn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateTaxAdjustment" (
    "id" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "CorporateTaxAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporateTaxReturn_companyId_idx" ON "CorporateTaxReturn"("companyId");

-- CreateIndex
CREATE INDEX "CorporateTaxReturn_status_idx" ON "CorporateTaxReturn"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateTaxReturn_companyId_periodFrom_periodTo_key" ON "CorporateTaxReturn"("companyId", "periodFrom", "periodTo");

-- CreateIndex
CREATE INDEX "CorporateTaxAdjustment_returnId_idx" ON "CorporateTaxAdjustment"("returnId");

-- AddForeignKey
ALTER TABLE "CorporateTaxReturn" ADD CONSTRAINT "CorporateTaxReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateTaxAdjustment" ADD CONSTRAINT "CorporateTaxAdjustment_returnId_fkey" FOREIGN KEY ("returnId") REFERENCES "CorporateTaxReturn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

