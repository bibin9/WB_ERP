-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'Main store';

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "binId" TEXT;

-- CreateTable
CREATE TABLE "StorageBin" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" TEXT,
    "name" TEXT,
    "materialType" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageBin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StorageBin_storeId_idx" ON "StorageBin"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageBin_storeId_code_key" ON "StorageBin"("storeId", "code");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_binId_fkey" FOREIGN KEY ("binId") REFERENCES "StorageBin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageBin" ADD CONSTRAINT "StorageBin_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

