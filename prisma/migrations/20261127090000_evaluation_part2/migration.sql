-- ADR-0036: Evaluation part 2: syllabus chapters (Academic), grading schemes, report card settings.
-- Chapter ids on exam subjects are plain ids (no foreign key), like every other module's record in
-- the Evaluation tables (ADR-0035), so the module can still become its own service.
-- AlterTable
ALTER TABLE "exam_subjects" ADD COLUMN     "chapter_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

-- AlterTable
ALTER TABLE "exams" ADD COLUMN     "grading_scheme_id" UUID;

-- CreateTable
CREATE TABLE "chapters" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "subject_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_schemes" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "grading_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grading_bands" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "grading_scheme_id" UUID NOT NULL,
    "grade" VARCHAR(10) NOT NULL,
    "min_percentage" DECIMAL(5,2) NOT NULL,
    "grade_point" DECIMAL(4,2),
    "remark" VARCHAR(60),

    CONSTRAINT "grading_bands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_card_settings" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "title" VARCHAR(80) NOT NULL DEFAULT 'Progress report',
    "header_line" VARCHAR(200),
    "footer_note" VARCHAR(300),
    "signature_labels" TEXT[] NOT NULL DEFAULT ARRAY['Class teacher', 'Principal', 'Parent']::TEXT[],
    "logo_file_id" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "report_card_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chapters_organization_id_subject_id_idx" ON "chapters"("organization_id", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_subject_id_name_key" ON "chapters"("subject_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "grading_schemes_organization_id_name_key" ON "grading_schemes"("organization_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "grading_bands_grading_scheme_id_grade_key" ON "grading_bands"("grading_scheme_id", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "grading_bands_grading_scheme_id_min_percentage_key" ON "grading_bands"("grading_scheme_id", "min_percentage");

-- CreateIndex
CREATE UNIQUE INDEX "report_card_settings_organization_id_key" ON "report_card_settings"("organization_id");

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "subjects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exams" ADD CONSTRAINT "exams_grading_scheme_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "grading_schemes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_schemes" ADD CONSTRAINT "grading_schemes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_bands" ADD CONSTRAINT "grading_bands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grading_bands" ADD CONSTRAINT "grading_bands_grading_scheme_id_fkey" FOREIGN KEY ("grading_scheme_id") REFERENCES "grading_schemes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_card_settings" ADD CONSTRAINT "report_card_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- (by hand) Values that make sense.
ALTER TABLE "grading_bands" ADD CONSTRAINT "grading_bands_min_percentage_check"
  CHECK ("min_percentage" >= 0 AND "min_percentage" <= 100);
-- (by hand) At most one default grading scheme per organization.
CREATE UNIQUE INDEX "grading_schemes_one_default" ON "grading_schemes"("organization_id") WHERE "is_default";

-- (by hand) Row security: the same rule as every organization table.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['chapters', 'grading_schemes', 'grading_bands', 'report_card_settings'] LOOP
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
