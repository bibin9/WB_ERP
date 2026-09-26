-- CreateTable
CREATE TABLE "OrderTemplate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partyId" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTemplateLine" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "itemId" TEXT,
    "description" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL DEFAULT 'EA',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderTemplateLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderTemplate_companyId_name_key" ON "OrderTemplate"("companyId", "name");

-- CreateIndex
CREATE INDEX "OrderTemplateLine_templateId_idx" ON "OrderTemplateLine"("templateId");

-- AddForeignKey
ALTER TABLE "OrderTemplate" ADD CONSTRAINT "OrderTemplate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTemplateLine" ADD CONSTRAINT "OrderTemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OrderTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

