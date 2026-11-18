-- =================================================================================================
-- ADR-0030: Organization -> Branches, and one academic engine shaped by the organization's type.
--
-- Institutions and campuses become BRANCHES (ids are kept, so roles and audit entries keep
-- pointing at the right place); academic years, subjects, document types and settings move to
-- the organization; class levels and batches go.
--
-- When this was written, the only data was setup data (organizations, institutions, roles, users,
-- one academic year). The first block STOPS the migration, before anything changes, if it finds
-- data it can't map safely.
-- =================================================================================================

-- 1. SAFETY CHECK ---------------------------------------------------------------------------------
DO $$
DECLARE
  problem text;
BEGIN
  SELECT string_agg(t || ' (' || n || ')', ', ') INTO problem FROM (
    SELECT 'classes' t, count(*) n FROM classes
    UNION ALL SELECT 'students', count(*) FROM students
    UNION ALL SELECT 'enrolments', count(*) FROM enrolments
    UNION ALL SELECT 'attendance_records', count(*) FROM attendance_records
    UNION ALL SELECT 'subjects', count(*) FROM subjects
    UNION ALL SELECT 'holidays', count(*) FROM holidays
    UNION ALL SELECT 'document_types', count(*) FROM document_types
    UNION ALL SELECT 'promotion_runs', count(*) FROM promotion_runs
    UNION ALL SELECT 'admission_sequences', count(*) FROM admission_sequences
  ) x WHERE n > 0;
  IF problem IS NOT NULL THEN
    RAISE EXCEPTION 'ADR-0030 migration: these tables have data that needs a hand-written migration: %', problem;
  END IF;

  -- A role at an institution that has campuses has no single branch to go to.
  IF EXISTS (SELECT 1 FROM user_roles ur
             WHERE ur.institution_id IS NOT NULL AND ur.campus_id IS NULL
               AND EXISTS (SELECT 1 FROM campuses c WHERE c.institution_id = ur.institution_id)) THEN
    RAISE EXCEPTION 'ADR-0030 migration: roles are given at an institution that has campuses; give them at a campus first';
  END IF;

  -- Two institutions of one organization with an academic year of the same name.
  IF EXISTS (SELECT 1 FROM academic_years GROUP BY organization_id, name HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'ADR-0030 migration: an organization has two academic years with the same name';
  END IF;

  -- Branch codes must be unique in the organization (campus codes were only unique per institution).
  IF EXISTS (
    SELECT 1 FROM (
      SELECT organization_id, code FROM campuses
      UNION ALL
      SELECT i.organization_id, i.code FROM institutions i
      WHERE NOT EXISTS (SELECT 1 FROM campuses c WHERE c.institution_id = i.id)
    ) b GROUP BY organization_id, code HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'ADR-0030 migration: two future branches of one organization share a code';
  END IF;
END
$$;

-- 2. NEW TYPES --------------------------------------------------------------------------------------
CREATE TYPE "OrganizationType" AS ENUM ('SCHOOL', 'INTERMEDIATE', 'DEGREE', 'ENGINEERING');
CREATE TYPE "AdmissionNumbering" AS ENUM ('AUTOMATIC', 'MANUAL');
ALTER TYPE "EnrolmentStatus" ADD VALUE 'MOVED';

-- Students: ALUMNI is now called COMPLETED (an "outgoing" status). No student rows exist (step 1).
CREATE TYPE "StudentStatus_new" AS ENUM ('ACTIVE', 'TRANSFERRED', 'DISCONTINUED', 'COMPLETED');
ALTER TABLE "students" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "students" ALTER COLUMN "status" TYPE "StudentStatus_new" USING ("status"::text::"StudentStatus_new");
ALTER TABLE "student_status_changes" ALTER COLUMN "from_status" TYPE "StudentStatus_new" USING ("from_status"::text::"StudentStatus_new");
ALTER TABLE "student_status_changes" ALTER COLUMN "to_status" TYPE "StudentStatus_new" USING ("to_status"::text::"StudentStatus_new");
ALTER TYPE "StudentStatus" RENAME TO "StudentStatus_old";
ALTER TYPE "StudentStatus_new" RENAME TO "StudentStatus";
DROP TYPE "StudentStatus_old";
ALTER TABLE "students" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- 3. ORGANIZATIONS: type, code and the settings that belonged to institutions -----------------------
ALTER TABLE "organizations"
  ADD COLUMN "code" TEXT,
  ADD COLUMN "type" "OrganizationType",
  ADD COLUMN "level_names" TEXT[],
  ADD COLUMN "weekly_off_days" INTEGER[] DEFAULT ARRAY[0]::INTEGER[],
  ADD COLUMN "time_zone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  ADD COLUMN "attendance_correction_days" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "admission_numbering" "AdmissionNumbering" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "admission_no_pattern" TEXT;

-- Existing organizations are junior colleges (the super admin can change the type while the
-- organization has no academic structure yet); the code comes from the slug.
UPDATE "organizations" SET
  "type" = 'INTERMEDIATE',
  "level_names" = ARRAY['Year', 'Group', 'Stream', 'Section'],
  "code" = upper(left(regexp_replace("slug", '[^a-zA-Z0-9]', '', 'g'), 10));

-- Settings from the organization's oldest institution.
UPDATE "organizations" o SET
  "weekly_off_days" = i."weekly_off_days",
  "time_zone" = i."time_zone",
  "attendance_correction_days" = i."attendance_correction_days",
  "admission_no_pattern" = i."admission_no_pattern",
  "admission_numbering" = CASE WHEN i."admission_no_pattern" IS NULL THEN 'MANUAL'::"AdmissionNumbering"
                               ELSE 'AUTOMATIC'::"AdmissionNumbering" END
FROM (
  SELECT DISTINCT ON ("organization_id") * FROM "institutions" ORDER BY "organization_id", "created_at"
) i
WHERE i."organization_id" = o."id";

ALTER TABLE "organizations"
  ALTER COLUMN "code" SET NOT NULL,
  ALTER COLUMN "type" SET NOT NULL;

-- 4. BRANCHES: every campus, and every institution without campuses (same ids) --------------------
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PlaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "branches"("organization_id", "code");
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "branches" ("id", "organization_id", "name", "code", "status", "created_at", "updated_at")
SELECT c."id", c."organization_id", c."name", c."code", c."status", c."created_at", c."updated_at"
FROM "campuses" c;

INSERT INTO "branches" ("id", "organization_id", "name", "code", "status", "created_at", "updated_at")
SELECT i."id", i."organization_id", i."name", i."code", i."status", i."created_at", i."updated_at"
FROM "institutions" i
WHERE NOT EXISTS (SELECT 1 FROM "campuses" c WHERE c."institution_id" = i."id");

-- Row security, as for every table with organization_id.
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "branches" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON "branches"
  USING (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true))
  WITH CHECK (current_setting('app.bypass_rls', true) = 'on'
         OR "organization_id"::text = current_setting('app.organization_id', true));

-- 5. ROLES AT A PLACE: user_roles.branch_id ----------------------------------------------------------
ALTER TABLE "user_roles" ADD COLUMN "branch_id" UUID;
UPDATE "user_roles" SET "branch_id" = COALESCE("campus_id", "institution_id")
WHERE COALESCE("campus_id", "institution_id") IS NOT NULL;

-- 6. AUDIT LOG: branch_id (the migration runs as the table owner, which may update) ----------------
ALTER TABLE "audit_logs" ADD COLUMN "branch_id" UUID;
UPDATE "audit_logs" a SET "branch_id" = COALESCE(
  (SELECT b."id" FROM "branches" b WHERE b."id" = a."campus_id"),
  (SELECT b."id" FROM "branches" b WHERE b."id" = a."institution_id"))
WHERE a."campus_id" IS NOT NULL OR a."institution_id" IS NOT NULL;
ALTER TABLE "audit_logs" DROP COLUMN "campus_id", DROP COLUMN "institution_id";

-- 7. THE OLD PLACE COLUMNS AND TABLES GO ---------------------------------------------------------------
ALTER TABLE "academic_years" DROP CONSTRAINT "academic_years_institution_id_fkey";
ALTER TABLE "admission_sequences" DROP CONSTRAINT "admission_sequences_institution_id_fkey";
ALTER TABLE "batches" DROP CONSTRAINT "batches_institution_id_fkey";
ALTER TABLE "batches" DROP CONSTRAINT "batches_organization_id_fkey";
ALTER TABLE "campuses" DROP CONSTRAINT "campuses_institution_id_fkey";
ALTER TABLE "campuses" DROP CONSTRAINT "campuses_organization_id_fkey";
ALTER TABLE "class_levels" DROP CONSTRAINT "class_levels_institution_id_fkey";
ALTER TABLE "class_levels" DROP CONSTRAINT "class_levels_organization_id_fkey";
ALTER TABLE "classes" DROP CONSTRAINT "classes_campus_id_fkey";
ALTER TABLE "classes" DROP CONSTRAINT "classes_institution_id_fkey";
ALTER TABLE "document_types" DROP CONSTRAINT "document_types_institution_id_fkey";
ALTER TABLE "enrolments" DROP CONSTRAINT "enrolments_campus_id_fkey";
ALTER TABLE "enrolments" DROP CONSTRAINT "enrolments_institution_id_fkey";
ALTER TABLE "holidays" DROP CONSTRAINT "holidays_campus_id_fkey";
ALTER TABLE "holidays" DROP CONSTRAINT "holidays_institution_id_fkey";
ALTER TABLE "institutions" DROP CONSTRAINT "institutions_organization_id_fkey";
ALTER TABLE "students" DROP CONSTRAINT "students_batch_id_fkey";
ALTER TABLE "students" DROP CONSTRAINT "students_campus_id_fkey";
ALTER TABLE "students" DROP CONSTRAINT "students_institution_id_fkey";
ALTER TABLE "subjects" DROP CONSTRAINT "subjects_institution_id_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_campus_id_fkey";
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_institution_id_fkey";

DROP INDEX "academic_years_institution_id_name_key";
DROP INDEX "academic_years_organization_id_idx";
DROP INDEX "admission_sequences_organization_id_idx";
DROP INDEX "classes_campus_id_idx";
DROP INDEX "document_types_institution_id_name_key";
DROP INDEX "document_types_organization_id_idx";
DROP INDEX "enrolments_student_id_academic_year_id_key";
DROP INDEX "holidays_institution_id_starts_on_idx";
DROP INDEX "holidays_organization_id_idx";
DROP INDEX "promotion_runs_campus_id_created_at_idx";
DROP INDEX "students_batch_id_idx";
DROP INDEX "students_campus_id_idx";
DROP INDEX "students_institution_id_admission_no_key";
DROP INDEX "students_organization_id_idx";
DROP INDEX "subjects_institution_id_code_key";
DROP INDEX "subjects_organization_id_idx";
DROP INDEX "user_roles_campus_id_idx";
DROP INDEX "user_roles_institution_id_idx";

ALTER TABLE "academic_years" DROP COLUMN "institution_id";

ALTER TABLE "admission_sequences" DROP CONSTRAINT "admission_sequences_pkey",
DROP COLUMN "institution_id",
ADD COLUMN     "scope" TEXT NOT NULL,
ADD CONSTRAINT "admission_sequences_pkey" PRIMARY KEY ("organization_id", "scope", "period");

ALTER TABLE "attendance_records" DROP COLUMN "campus_id",
DROP COLUMN "institution_id",
ADD COLUMN     "branch_id" UUID NOT NULL;

ALTER TABLE "classes" DROP COLUMN "campus_id",
DROP COLUMN "institution_id",
ADD COLUMN     "branch_id" UUID,
ADD COLUMN     "built_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "long_term" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "next_class_id" UUID;

ALTER TABLE "document_types" DROP COLUMN "institution_id";

ALTER TABLE "enrolments" DROP COLUMN "campus_id",
DROP COLUMN "institution_id",
ADD COLUMN     "branch_id" UUID NOT NULL,
ADD COLUMN     "ended_on" DATE,
ADD COLUMN     "reason" TEXT;

ALTER TABLE "holidays" DROP COLUMN "campus_id",
DROP COLUMN "institution_id",
ADD COLUMN     "branch_id" UUID;

ALTER TABLE "promotion_runs" DROP COLUMN "batch_stages",
DROP COLUMN "campus_id",
DROP COLUMN "graduated",
DROP COLUMN "institution_id",
ADD COLUMN     "branch_id" UUID NOT NULL,
ADD COLUMN     "completed" INTEGER NOT NULL;

ALTER TABLE "role_templates" ADD COLUMN "built_in" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "student_status_changes" ADD COLUMN "destination" TEXT;

ALTER TABLE "students" DROP COLUMN "batch_id",
DROP COLUMN "campus_id",
DROP COLUMN "institution_id",
ADD COLUMN     "branch_id" UUID NOT NULL,
ADD COLUMN     "previous_institution" TEXT,
ADD COLUMN     "previous_marks" TEXT;

ALTER TABLE "subjects" DROP COLUMN "institution_id";

ALTER TABLE "user_roles" DROP COLUMN "campus_id",
DROP COLUMN "institution_id";

DROP TABLE "batches";
DROP TABLE "campuses";
DROP TABLE "class_levels";
DROP TABLE "institutions";
DROP TYPE "BatchStatus";

-- 8. NEW INDEXES AND LINKS ------------------------------------------------------------------------------
CREATE UNIQUE INDEX "academic_years_organization_id_name_key" ON "academic_years"("organization_id", "name");
CREATE INDEX "attendance_records_branch_id_date_idx" ON "attendance_records"("branch_id", "date");
CREATE INDEX "classes_branch_id_idx" ON "classes"("branch_id");
CREATE UNIQUE INDEX "document_types_organization_id_name_key" ON "document_types"("organization_id", "name");
CREATE INDEX "enrolments_student_id_idx" ON "enrolments"("student_id");
CREATE INDEX "holidays_organization_id_starts_on_idx" ON "holidays"("organization_id", "starts_on");
CREATE INDEX "promotion_runs_branch_id_created_at_idx" ON "promotion_runs"("branch_id", "created_at");
CREATE INDEX "students_branch_id_idx" ON "students"("branch_id");
CREATE UNIQUE INDEX "students_organization_id_admission_no_key" ON "students"("organization_id", "admission_no");
CREATE UNIQUE INDEX "subjects_organization_id_code_key" ON "subjects"("organization_id", "code");
CREATE INDEX "user_roles_branch_id_idx" ON "user_roles"("branch_id");

-- At most one ACTIVE enrolment (placement) per student (ADR-0030); Prisma can't describe this.
CREATE UNIQUE INDEX "enrolments_one_active_per_student" ON "enrolments"("student_id") WHERE "status" = 'ACTIVE';

-- A roll number is unique among the students CURRENTLY in a section (a student who moved out
-- keeps their old roll number in the history, and someone else may get it).
DROP INDEX "enrolments_roll_no_key";
CREATE UNIQUE INDEX "enrolments_roll_no_key"
  ON "enrolments" ("class_id", "academic_year_id", "roll_no")
  WHERE "roll_no" IS NOT NULL AND "status" = 'ACTIVE';

ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classes" ADD CONSTRAINT "classes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "classes" ADD CONSTRAINT "classes_next_class_id_fkey" FOREIGN KEY ("next_class_id") REFERENCES "classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "students" ADD CONSTRAINT "students_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrolments" ADD CONSTRAINT "enrolments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 9. PERMISSIONS: institution / campus become branch; batches go -------------------------------------
--   platform.institution.view   -> platform.branch.view
--   platform.institution.update -> platform.branch.update
--   platform.campus.update      -> platform.branch.update
--   platform.campus.create / .delete, academic.batch.*  -> removed (branches are the super admin's)
CREATE FUNCTION pg_temp.adr30_permissions(perms text[]) RETURNS text[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(DISTINCT p ORDER BY p), ARRAY[]::text[]) FROM (
    SELECT CASE
      WHEN x = 'platform.institution.view' THEN 'platform.branch.view'
      WHEN x IN ('platform.institution.update', 'platform.campus.update') THEN 'platform.branch.update'
      WHEN x LIKE 'platform.campus.%' OR x LIKE 'academic.batch.%' THEN NULL
      ELSE x END AS p
    FROM unnest(perms) AS x
  ) mapped WHERE p IS NOT NULL
$$;
UPDATE "roles" SET "permissions" = pg_temp.adr30_permissions("permissions");
UPDATE "role_templates" SET "permissions" = pg_temp.adr30_permissions("permissions");

-- "Campus admin" is now "Branch admin" (the app fills in the description at startup).
INSERT INTO "role_templates" ("key", "name", "description", "permissions", "assignable", "built_in", "sort_order", "updated_at")
SELECT 'branch_admin', 'Branch admin', "description", "permissions", "assignable", true, "sort_order", now()
FROM "role_templates" WHERE "key" = 'campus_admin';
UPDATE "roles" SET "template_key" = 'branch_admin',
  "name" = CASE WHEN "name" = 'Campus admin' THEN 'Branch admin' ELSE "name" END
WHERE "template_key" = 'campus_admin';
DELETE FROM "role_templates" WHERE "key" = 'campus_admin';
