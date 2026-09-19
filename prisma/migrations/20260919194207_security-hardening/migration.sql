-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionsEndedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "requestedById" TEXT;

-- AlterTable
ALTER TABLE "ApprovalStep" ADD COLUMN     "decidedById" TEXT;

-- CreateTable
CREATE TABLE "SignInThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "SignInThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "SignInThrottle_windowStart_idx" ON "SignInThrottle"("windowStart");

