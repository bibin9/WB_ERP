-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "leadId" TEXT,
    "estimateId" TEXT,
    "partyId" TEXT,
    "customerName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "costAtQuote" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budgetHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "validUntil" TIMESTAMP(3),
    "terms" TEXT,
    "notes" TEXT,
    "approvalRequestId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "issuedBy" TEXT,
    "issuedTo" TEXT,
    "poNumber" TEXT,
    "poDate" TIMESTAMP(3),
    "poValue" DOUBLE PRECISION,
    "poRef" TEXT,
    "poAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "declinedReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "jobId" TEXT,
    "preparedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_supersedesId_key" ON "Quotation"("supersedesId");

-- CreateIndex
CREATE INDEX "Quotation_companyId_idx" ON "Quotation"("companyId");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_leadId_idx" ON "Quotation"("leadId");

-- CreateIndex
CREATE INDEX "Quotation_estimateId_idx" ON "Quotation"("estimateId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_companyId_number_key" ON "Quotation"("companyId", "number");

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

