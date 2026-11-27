/**
 * GRADES (ADR-0037): turning a percentage into a grade (A+, A, B ...) and a grade point.
 *
 * A grading scheme is a list of bands, each "from this percentage up": with bands A+ 90, A 75,
 * B 60, C 35, D 0, a student with 74.99 % gets B. Every scheme has a band starting at 0 %, so
 * every percentage has a grade.
 *
 *   gradeOf(scheme, 82.5)       the band for a percentage
 *   gradesOf(scheme, subjects, cells, percentage)
 *                               a student's grade per subject, overall grade and GPA
 *
 * Per subject: the subject's percentage (marks / maximum). ABSENT counts as 0 %. EXEMPT has no
 * grade. Overall: the grade of the overall percentage. GPA: the average grade point of the
 * subjects with a grade, only when every band of the scheme has a grade point.
 */
import type { ExamSubjectInfo } from './exams.service';

export interface Band {
  grade: string;
  minPercentage: number;
  gradePoint: number | null;
  remark: string | null;
}

export interface Scheme {
  id: string;
  name: string;
  /** Highest band first. */
  bands: Band[];
}

type Cell = { status: 'PRESENT' | 'ABSENT' | 'EXEMPT'; marks: number | null };

/** The band a percentage falls in (the highest band starting at or below it). */
export function gradeOf(scheme: Scheme, percentage: number): Band {
  return (
    scheme.bands.find((b) => percentage >= b.minPercentage) ?? scheme.bands[scheme.bands.length - 1]
  );
}

/** A scheme row from the database, with its bands sorted highest first. */
export function toScheme(row: {
  id: string;
  name: string;
  bands: { grade: string; minPercentage: unknown; gradePoint: unknown; remark: string | null }[];
}): Scheme {
  return {
    id: row.id,
    name: row.name,
    bands: row.bands
      .map((b) => ({
        grade: b.grade,
        minPercentage: Number(b.minPercentage),
        gradePoint: b.gradePoint === null ? null : Number(b.gradePoint),
        remark: b.remark,
      }))
      .sort((a, b) => b.minPercentage - a.minPercentage),
  };
}

/** A student's grades: per subject id, overall, and the GPA (see the top of this file). */
export function gradesOf(
  scheme: Scheme | null,
  subjects: ExamSubjectInfo[],
  cells: Map<string, Cell>,
  percentage: number | null,
) {
  if (!scheme) return { subjectGrades: {}, grade: null, gradeRemark: null, gpa: null };
  const subjectGrades: Record<string, string> = {};
  const points: number[] = [];
  const withPoints = scheme.bands.every((b) => b.gradePoint !== null);
  for (const s of subjects) {
    const cell = cells.get(s.subjectId);
    if (!cell || cell.status === 'EXEMPT') continue;
    const pct = cell.status === 'ABSENT' ? 0 : ((cell.marks ?? 0) / s.maxMarks) * 100;
    const band = gradeOf(scheme, Math.round(pct * 100) / 100);
    subjectGrades[s.subjectId] = band.grade;
    if (withPoints) points.push(band.gradePoint!);
  }
  const overall = percentage === null ? null : gradeOf(scheme, percentage);
  return {
    subjectGrades,
    grade: overall?.grade ?? null,
    gradeRemark: overall?.remark ?? null,
    gpa:
      withPoints && points.length > 0
        ? Math.round((points.reduce((a, b) => a + b, 0) / points.length) * 100) / 100
        : null,
  };
}

/** Checks a scheme's bands; returns the reason they can't be used, or null. */
export function bandsProblem(bands: { grade: string; minPercentage: number }[]): string | null {
  const grades = bands.map((b) => b.grade.trim().toUpperCase());
  if (new Set(grades).size !== grades.length) return 'A grade appears twice';
  const mins = bands.map((b) => b.minPercentage);
  if (new Set(mins).size !== mins.length) return 'Two grades start at the same percentage';
  if (!mins.includes(0)) return 'One grade must start at 0 %, so every percentage has a grade';
  return null;
}
