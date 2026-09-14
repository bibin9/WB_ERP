-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "purchaseOrderLineId" TEXT;

-- CreateTable
CREATE TABLE "MaterialRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "jobId" TEXT,
    "storeId" TEXT,
    "neededBy" TIMESTAMP(3),
    "requestedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL DEFAULT 'EA',
    "quantity" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MaterialRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Draft',
    "partyId" TEXT NOT NULL,
    "partyName" TEXT NOT NULL,
    "jobId" TEXT,
    "storeId" TEXT,
    "requestId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "approvalRequestId" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "raisedBy" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL DEFAULT 'EA',
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "netAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "jobId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaterialRequest_companyId_idx" ON "MaterialRequest"("companyId");

-- CreateIndex
CREATE INDEX "MaterialRequest_status_idx" ON "MaterialRequest"("status");

-- CreateIndex
CREATE INDEX "MaterialRequest_jobId_idx" ON "MaterialRequest"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "MaterialRequest_companyId_number_key" ON "MaterialRequest"("companyId", "number");

-- CreateIndex
CREATE INDEX "MaterialRequestLine_requestId_idx" ON "MaterialRequestLine"("requestId");

-- CreateIndex
CREATE INDEX "MaterialRequestLine_itemId_idx" ON "MaterialRequestLine"("itemId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_companyId_idx" ON "PurchaseOrder"("companyId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_partyId_idx" ON "PurchaseOrder"("partyId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_jobId_idx" ON "PurchaseOrder"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_companyId_number_key" ON "PurchaseOrder"("companyId", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_orderId_idx" ON "PurchaseOrderLine"("orderId");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_itemId_idx" ON "PurchaseOrderLine"("itemId");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequest" ADD CONSTRAINT "MaterialRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialRequestLine" ADD CONSTRAINT "MaterialRequestLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "MaterialRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

