-- Evaluation (ADR-0035): what an exam covers in each subject ("Ch 1-4, Trigonometry").
ALTER TABLE "exam_subjects" ADD COLUMN "portion" VARCHAR(300);
