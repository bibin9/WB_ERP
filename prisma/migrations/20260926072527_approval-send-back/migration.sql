-- CreateTable
CREATE TABLE "ApprovalReturn" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromOrder" INTEGER NOT NULL,
    "toOrder" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "sentBy" TEXT NOT NULL,
    "sentById" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalReturn_requestId_idx" ON "ApprovalReturn"("requestId");

-- AddForeignKey
ALTER TABLE "ApprovalReturn" ADD CONSTRAINT "ApprovalReturn_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

