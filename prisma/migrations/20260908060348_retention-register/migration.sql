-- CreateTable
CREATE TABLE "Retention" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "jobId" TEXT,
    "partyId" TEXT,
    "partyName" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'Defects liability',
    "status" TEXT NOT NULL DEFAULT 'Held',
    "releasedOn" TIMESTAMP(3),
    "entryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Retention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Retention_companyId_idx" ON "Retention"("companyId");

-- CreateIndex
CREATE INDEX "Retention_status_idx" ON "Retention"("status");

-- CreateIndex
CREATE INDEX "Retention_dueDate_idx" ON "Retention"("dueDate");

-- CreateIndex
CREATE INDEX "Retention_jobId_idx" ON "Retention"("jobId");

-- CreateIndex
CREATE INDEX "Retention_partyId_idx" ON "Retention"("partyId");

-- CreateIndex
CREATE INDEX "Retention_entryId_idx" ON "Retention"("entryId");

-- AddForeignKey
ALTER TABLE "Retention" ADD CONSTRAINT "Retention_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retention" ADD CONSTRAINT "Retention_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retention" ADD CONSTRAINT "Retention_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Retention" ADD CONSTRAINT "Retention_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

