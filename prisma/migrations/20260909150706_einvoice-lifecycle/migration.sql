-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "eInvoiceAckAt" TIMESTAMP(3),
ADD COLUMN     "eInvoiceAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eInvoiceError" TEXT,
ADD COLUMN     "eInvoiceRef" TEXT,
ADD COLUMN     "eInvoiceSentAt" TIMESTAMP(3),
ADD COLUMN     "eInvoiceStatus" TEXT NOT NULL DEFAULT 'Not applicable',
ADD COLUMN     "eInvoiceXml" TEXT;

-- AlterTable
ALTER TABLE "FinancePolicy" ADD COLUMN     "eInvoiceCustomizationId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "eInvoiceProfileId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "eInvoiceProvider" TEXT NOT NULL DEFAULT '';

