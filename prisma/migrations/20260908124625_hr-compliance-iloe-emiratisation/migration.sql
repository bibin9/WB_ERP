-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "emiratisationSector" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "iloeExempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "iloeExpiry" TIMESTAMP(3),
ADD COLUMN     "iloeSubscribed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "skilledRole" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "firstIn" TIMESTAMP(3),
ADD COLUMN     "lastOut" TIMESTAMP(3);

