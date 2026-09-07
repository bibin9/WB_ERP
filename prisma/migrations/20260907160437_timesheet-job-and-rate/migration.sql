-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "hourlyCost" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Timesheet" ADD COLUMN     "costRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "entryId" TEXT,
ADD COLUMN     "jobId" TEXT,
ALTER COLUMN "projectRef" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Timesheet_jobId_idx" ON "Timesheet"("jobId");

-- CreateIndex
CREATE INDEX "Timesheet_entryId_idx" ON "Timesheet"("entryId");

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

