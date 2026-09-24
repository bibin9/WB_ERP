-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "emailLogRetentionDays" INTEGER NOT NULL DEFAULT 1095,
ADD COLUMN     "notificationRetentionDays" INTEGER NOT NULL DEFAULT 180;

-- CreateTable
CREATE TABLE "EmailLogArchive" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "toAddresses" TEXT NOT NULL,
    "ccAddresses" TEXT,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "sentBy" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "messageId" TEXT,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLogArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailLogArchive_companyId_sentAt_idx" ON "EmailLogArchive"("companyId", "sentAt");

