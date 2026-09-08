-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "airTicketAllowance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "noticePeriodDays" INTEGER,
ADD COLUMN     "probationCleared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "probationEndDate" TIMESTAMP(3),
ADD COLUMN     "unpaidLeaveDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
ALTER COLUMN "annualLeaveBalance" SET DEFAULT 0;

