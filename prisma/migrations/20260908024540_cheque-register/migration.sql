-- CreateTable
CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "chequeNo" TEXT NOT NULL,
    "bankName" TEXT,
    "chequeDate" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "partyId" TEXT,
    "partyName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'In hand',
    "heldBy" TEXT,
    "depositedOn" TIMESTAMP(3),
    "settledOn" TIMESTAMP(3),
    "entryId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cheque_companyId_idx" ON "Cheque"("companyId");

-- CreateIndex
CREATE INDEX "Cheque_status_idx" ON "Cheque"("status");

-- CreateIndex
CREATE INDEX "Cheque_chequeDate_idx" ON "Cheque"("chequeDate");

-- CreateIndex
CREATE INDEX "Cheque_partyId_idx" ON "Cheque"("partyId");

-- CreateIndex
CREATE INDEX "Cheque_entryId_idx" ON "Cheque"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_companyId_direction_bankName_chequeNo_key" ON "Cheque"("companyId", "direction", "bankName", "chequeNo");

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

