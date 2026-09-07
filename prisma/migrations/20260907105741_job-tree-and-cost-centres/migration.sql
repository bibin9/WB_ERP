-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "costCentreId" TEXT;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'Contract';

-- CreateTable
CREATE TABLE "CostCentre" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCentre_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CostCentre_companyId_idx" ON "CostCentre"("companyId");

-- CreateIndex
CREATE INDEX "CostCentre_parentId_idx" ON "CostCentre"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCentre_companyId_code_key" ON "CostCentre"("companyId", "code");

-- CreateIndex
CREATE INDEX "JournalLine_jobId_idx" ON "JournalLine"("jobId");

-- CreateIndex
CREATE INDEX "JournalLine_costCentreId_idx" ON "JournalLine"("costCentreId");

-- CreateIndex
CREATE INDEX "Job_parentId_idx" ON "Job"("parentId");

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "CostCentre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCentre" ADD CONSTRAINT "CostCentre_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCentre" ADD CONSTRAINT "CostCentre_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CostCentre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

