-- CreateTable
CREATE TABLE "PartyAdvance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "partyId" TEXT,
    "partyName" TEXT,
    "jobId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "recoveryPercent" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "entryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyAdvanceRecovery" (
    "id" TEXT NOT NULL,
    "advanceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "invoiceId" TEXT,
    "entryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyAdvanceRecovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyAdvance_companyId_idx" ON "PartyAdvance"("companyId");

-- CreateIndex
CREATE INDEX "PartyAdvance_status_idx" ON "PartyAdvance"("status");

-- CreateIndex
CREATE INDEX "PartyAdvance_partyId_idx" ON "PartyAdvance"("partyId");

-- CreateIndex
CREATE INDEX "PartyAdvance_jobId_idx" ON "PartyAdvance"("jobId");

-- CreateIndex
CREATE INDEX "PartyAdvance_entryId_idx" ON "PartyAdvance"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyAdvance_companyId_direction_reference_key" ON "PartyAdvance"("companyId", "direction", "reference");

-- CreateIndex
CREATE INDEX "PartyAdvanceRecovery_advanceId_idx" ON "PartyAdvanceRecovery"("advanceId");

-- CreateIndex
CREATE INDEX "PartyAdvanceRecovery_invoiceId_idx" ON "PartyAdvanceRecovery"("invoiceId");

-- CreateIndex
CREATE INDEX "PartyAdvanceRecovery_entryId_idx" ON "PartyAdvanceRecovery"("entryId");

-- AddForeignKey
ALTER TABLE "PartyAdvance" ADD CONSTRAINT "PartyAdvance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAdvance" ADD CONSTRAINT "PartyAdvance_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAdvance" ADD CONSTRAINT "PartyAdvance_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAdvance" ADD CONSTRAINT "PartyAdvance_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAdvanceRecovery" ADD CONSTRAINT "PartyAdvanceRecovery_advanceId_fkey" FOREIGN KEY ("advanceId") REFERENCES "PartyAdvance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAdvanceRecovery" ADD CONSTRAINT "PartyAdvanceRecovery_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyAdvanceRecovery" ADD CONSTRAINT "PartyAdvanceRecovery_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

