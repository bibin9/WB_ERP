-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "clearedOn" TIMESTAMP(3),
ADD COLUMN     "statementRef" TEXT;

-- CreateIndex
CREATE INDEX "JournalLine_clearedOn_idx" ON "JournalLine"("clearedOn");

