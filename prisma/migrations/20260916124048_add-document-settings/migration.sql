-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "linesSnapshot" TEXT;

-- CreateTable
CREATE TABLE "DocumentSettings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accentColor" TEXT NOT NULL DEFAULT '#1F4E79',
    "headerImage" TEXT,
    "footerImage" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "footerNote" TEXT,
    "quotationTerms" TEXT,
    "purchaseOrderTerms" TEXT,
    "rfqTerms" TEXT,
    "showSignatures" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSettings_companyId_key" ON "DocumentSettings"("companyId");

-- AddForeignKey
ALTER TABLE "DocumentSettings" ADD CONSTRAINT "DocumentSettings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

