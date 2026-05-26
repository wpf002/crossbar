-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "awayMoneyLine" INTEGER,
ADD COLUMN     "homeMoneyLine" INTEGER,
ADD COLUMN     "overUnder" DOUBLE PRECISION,
ADD COLUMN     "spread" DOUBLE PRECISION;
