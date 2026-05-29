-- AlterEnum
ALTER TYPE "MarketType" ADD VALUE 'PERIOD_WINNER';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "awayLinescores" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "homeLinescores" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "Market" ADD COLUMN     "period" INTEGER;
