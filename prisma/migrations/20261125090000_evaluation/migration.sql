-- ADR-0035: Evaluation module, part 1: exam types, exams with subjects, marks, marks uploads.
-- Students, sections, branches, years and subjects are plain ids (no foreign keys), so the module
-- can become its own service (ADR-0024).

-- CreateEnum
CREATE TYPE "ExamStatus" AS ENUM ('OPEN', 'LOCKED');

-- CreateEnum
CREATE TYPE "MarkStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXEMPT');


-- CreateTable
CREATE TABLE "exam_types" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exam_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "exam_type_id" UUID NOT NULL,
    "academic_year_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "class_id" UUID NOT NULL,
    "branch_id" UUID,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE NOT NULL,
    "status" "ExamStatus" NOT NULL DEFAULT 'OPEN',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_subjects" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "max_marks" DECIMAL(6,2) NOT NULL,
    "pass_marks" DECIMAL(6,2) NOT NULL,
    "exam_date" DATE,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "exam_subjects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_marks" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "exam_id" UUID NOT NULL,
    "exam_subject_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "MarkStatus" NOT NULL,
    "marks" DECIMAL(6,2),
    "entered_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "exam_marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks_uploads" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "exam_id" UUID NOT NULL,
    "file_name" TEXT,
    "total_rows" INTEGER NOT NULL,
    "saved_count" INTEGER NOT NULL,
    "excluded_count" INTEGER NOT NULL,
    "excluded_rows" JSONB NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marks_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exam_types_organization_id_name_key" ON "exam_types"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "exam_types_organization_id_code_key" ON "exam_types"("organization_id", "code");

-- CreateIndex
CREATE INDEX "exams_organization_id_academic_year_id_idx" ON "exams"("organization_id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "exams_organization_id_academic_year_id_name_key" ON "exams"("organization_id", "academic_year_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "exam_subjects_exam_id_subject_id_key" ON "exam_subjects"("exam_id", "subject_id");

-- CreateIndex
CREATE INDEX "exam_marks_exam_id_class_id_idx" ON "exam_marks"("exam_id", "class_id");

-- CreateIndex
CREATE INDEX "exam_marks_student_id_idx" ON "exam_marks"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_marks_exam_subject_id_student_id_key" ON "exam_marks"("exam_subject_id", "student_id");

-- CreateIndex
CREATE INDEX "marks_uploads_exam_id_created_at_idx" ON "marks_uploads"("exam_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "marks_uploads_organization_id_number_key" ON "marks_uploads"("organization_id", "number");

-- AddForeignKey
ALTER TABLE "exam_types" ADD CONSTRAINT "exam_types_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_type_id_fkey" FOREIGN KEY ("exam_type_id") REFERENCES "exam_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_exam_subject_id_fkey" FOREIGN KEY ("exam_subject_id") REFERENCES "exam_subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks_uploads" ADD CONSTRAINT "marks_uploads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks_uploads" ADD CONSTRAINT "marks_uploads_exam_id_fkey" FOREIGN KEY ("exam_id") REFERENCES "exams"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- (by hand) Marks that make sense.
ALTER TABLE "exam_subjects" ADD CONSTRAINT "exam_subjects_marks_check"
  CHECK ("max_marks" > 0 AND "pass_marks" >= 0 AND "pass_marks" <= "max_marks");
ALTER TABLE "exam_marks" ADD CONSTRAINT "exam_marks_marks_check"
  CHECK (("status" = 'PRESENT' AND "marks" IS NOT NULL AND "marks" >= 0) OR ("status" <> 'PRESENT' AND "marks" IS NULL));
ALTER TABLE "exams" ADD CONSTRAINT "exams_dates_check" CHECK ("starts_on" <= "ends_on");

-- (by hand) Row security: the same rule as every organization table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['exam_types', 'exams', 'exam_subjects', 'exam_marks', 'marks_uploads'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY organization_isolation ON %I
         USING (current_setting(''app.bypass_rls'', true) = ''on''
                OR organization_id::text = current_setting(''app.organization_id'', true))
         WITH CHECK (current_setting(''app.bypass_rls'', true) = ''on''
                OR organization_id::text = current_setting(''app.organization_id'', true))', t);
  END LOOP;
END $$;

-- (by hand) The module, so the super admin can switch it on (also in prisma/seed.ts).
INSERT INTO "modules" ("key", "name", "description", "depends_on", "sort_order")
VALUES ('evaluation', 'Evaluation', 'Exam types, exams with subjects and marks, marks upload, results',
        ARRAY['academic', 'students'], 6)
ON CONFLICT ("key") DO NOTHING;

-- (by hand) The new permissions for the predefined roles of existing installations (new ones
-- get them from predefined-roles.ts). Organizations' copies follow at the next start, unless
-- customized (ADR-0029).
UPDATE "role_templates" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || CASE "key"
  WHEN 'principal' THEN ARRAY['evaluation.settings.view', 'evaluation.exam.view', 'evaluation.exam.create',
    'evaluation.exam.update', 'evaluation.exam.delete', 'evaluation.marks.view', 'evaluation.marks.enter',
    'evaluation.marks.import']
  WHEN 'branch_admin' THEN ARRAY['evaluation.exam.view', 'evaluation.marks.view', 'evaluation.marks.enter',
    'evaluation.marks.import']
  WHEN 'director' THEN ARRAY['evaluation.settings.view', 'evaluation.exam.view', 'evaluation.marks.view']
  WHEN 'senior_faculty' THEN ARRAY['evaluation.exam.view', 'evaluation.marks.view', 'evaluation.marks.enter']
  WHEN 'junior_faculty' THEN ARRAY['evaluation.exam.view', 'evaluation.marks.view', 'evaluation.marks.enter']
  WHEN 'dtp_operator' THEN ARRAY['evaluation.exam.view', 'evaluation.marks.view', 'evaluation.marks.enter',
    'evaluation.marks.import']
  ELSE ARRAY[]::TEXT[] END) ORDER BY 1)
WHERE "key" IN ('principal', 'branch_admin', 'director', 'senior_faculty', 'junior_faculty', 'dtp_operator');
