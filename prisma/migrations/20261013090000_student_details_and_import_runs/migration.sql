-- ADR-0031: more student details (contact, Aadhaar, category, stay and transport, previous
-- education, admission test, health, top rankers) and import records (import_runs).

-- CreateEnum
CREATE TYPE "ReservationCategory" AS ENUM ('OC', 'BC_A', 'BC_B', 'BC_C', 'BC_D', 'BC_E', 'SC', 'ST', 'EWS', 'OTHER');

-- CreateEnum
CREATE TYPE "Residence" AS ENUM ('DAY_SCHOLAR', 'HOSTELLER');

-- CreateEnum
CREATE TYPE "PreviousBoard" AS ENUM ('SSC', 'CBSE', 'ICSE', 'INTERMEDIATE', 'IB', 'OTHER');

-- CreateEnum
CREATE TYPE "LearnerLevel" AS ENUM ('EXPERT', 'MEDIUM', 'SLOW');

-- AlterTable
ALTER TABLE "students" ADD COLUMN     "aadhaar" TEXT,
ADD COLUMN     "admission_test_marks" DECIMAL(6,2),
ADD COLUMN     "admission_test_no" TEXT,
ADD COLUMN     "alternate_phone" TEXT,
ADD COLUMN     "area" TEXT,
ADD COLUMN     "bus_facility" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" "ReservationCategory",
ADD COLUMN     "hall_ticket_no" TEXT,
ADD COLUMN     "import_row" INTEGER,
ADD COLUMN     "import_run_id" UUID,
ADD COLUMN     "learner_level" "LearnerLevel",
ADD COLUMN     "medical_condition" TEXT,
ADD COLUMN     "permanent_address" TEXT,
ADD COLUMN     "pickup_point" TEXT,
ADD COLUMN     "previous_board" "PreviousBoard",
ADD COLUMN     "previous_grade" TEXT,
ADD COLUMN     "previous_percentage" DECIMAL(5,2),
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "residence" "Residence",
ADD COLUMN     "sub_caste" TEXT,
ADD COLUMN     "top_ranker" BOOLEAN NOT NULL DEFAULT false;

-- (by hand) Keep any free-text "previous marks" in the remarks before the column goes.
UPDATE "students" SET "remarks" = 'Previous marks: ' || "previous_marks" WHERE "previous_marks" IS NOT NULL;
ALTER TABLE "students" DROP COLUMN "previous_marks";

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "branch_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "file_name" TEXT,
    "total_rows" INTEGER NOT NULL,
    "imported_count" INTEGER NOT NULL,
    "excluded_count" INTEGER NOT NULL,
    "excluded_rows" JSONB NOT NULL,
    "imported_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_branch_id_created_at_idx" ON "import_runs"("branch_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "import_runs_organization_id_number_key" ON "import_runs"("organization_id", "number");

-- CreateIndex
CREATE INDEX "students_organization_id_top_ranker_idx" ON "students"("organization_id", "top_ranker");

-- AddForeignKey
ALTER TABLE "students" ADD CONSTRAINT "students_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- (by hand) An Aadhaar number belongs to one student in the organization.
CREATE UNIQUE INDEX "students_organization_id_aadhaar_key" ON "students"("organization_id", "aadhaar") WHERE "aadhaar" IS NOT NULL;

-- (by hand) Row security: the same rule as every organization table
ALTER TABLE "import_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_runs" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON "import_runs"
  USING (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true));
