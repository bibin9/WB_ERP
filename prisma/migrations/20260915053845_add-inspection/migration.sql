-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "requiresInspection" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "inspectedAt" TIMESTAMP(3),
ADD COLUMN     "inspectedBy" TEXT,
ADD COLUMN     "inspection" TEXT,
ADD COLUMN     "inspectionNote" TEXT;

