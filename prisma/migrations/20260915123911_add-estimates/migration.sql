-- CreateTable
CREATE TABLE "Estimate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "leadId" TEXT,
    "overheadPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fixedCosts" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "basisKind" TEXT NOT NULL DEFAULT 'markup',
    "basisValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "acceptLoss" BOOLEAN NOT NULL DEFAULT false,
    "preparedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateLine" (
    "id" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "ref" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'Piece',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "materialCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "labourHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "labourRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plantHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "plantRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subcontractCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EstimateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TakeoffLine" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL DEFAULT 'EA',
    "perUnit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wastage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TakeoffLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Estimate_companyId_idx" ON "Estimate"("companyId");

-- CreateIndex
CREATE INDEX "Estimate_leadId_idx" ON "Estimate"("leadId");

-- CreateIndex
CREATE INDEX "Estimate_status_idx" ON "Estimate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_companyId_number_key" ON "Estimate"("companyId", "number");

-- CreateIndex
CREATE INDEX "EstimateLine_estimateId_idx" ON "EstimateLine"("estimateId");

-- CreateIndex
CREATE INDEX "TakeoffLine_lineId_idx" ON "TakeoffLine"("lineId");

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateLine" ADD CONSTRAINT "EstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffLine" ADD CONSTRAINT "TakeoffLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "EstimateLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TakeoffLine" ADD CONSTRAINT "TakeoffLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

