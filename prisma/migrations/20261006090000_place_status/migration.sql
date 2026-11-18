-- Campuses and institutions are deactivated instead of deleted (ADR-0026): their records stay,
-- but nothing new happens there until they are activated again.
CREATE TYPE "PlaceStatus" AS ENUM ('ACTIVE', 'INACTIVE');

ALTER TABLE "institutions" ADD COLUMN "status" "PlaceStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "campuses" ADD COLUMN "status" "PlaceStatus" NOT NULL DEFAULT 'ACTIVE';
