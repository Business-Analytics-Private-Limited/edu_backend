/**
 * WHO TAKES PART IN AN EXAM (ADR-0035).
 *
 * An exam is for a part of the structure (`exam.classId`: a year, group, stream or one section)
 * at one branch or at every branch (`exam.branchId` empty):
 *
 *   sectionsOf(tree, exam, level)   the active sections under that part, at that branch / all
 *   participantsOf(db, exam, ids)   the students placed in those sections during the exam
 *
 * A student's placement counts when it is in the exam's academic year and its period overlaps
 * the exam dates. A student who changed section in that time keeps the latest placement.
 */
import type { Exam } from '@prisma/client';
import type { Db } from '../../prisma/prisma.service';
import type { ClassTree } from '../academic/class-tree';

export interface ExamSection {
  id: string;
  label: string;
  branchId: string;
}

export interface Participant {
  studentId: string;
  admissionNo: string;
  fullName: string;
  rollNo: string | null;
  /** The section and branch of the placement during the exam. */
  classId: string;
  branchId: string;
}

type ExamPlace = Pick<Exam, 'classId' | 'branchId'>;

/** The active sections the exam covers, in label order. */
export function sectionsOf(tree: ClassTree, exam: ExamPlace, sectionLevel: number): ExamSection[] {
  return tree
    .below(exam.classId)
    .map((id) => tree.get(id)!)
    .filter(
      (c) =>
        c.level === sectionLevel &&
        c.isActive &&
        !!c.branchId &&
        (!exam.branchId || c.branchId === exam.branchId),
    )
    .map((c) => ({ id: c.id, label: tree.label(c.id), branchId: c.branchId! }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** The students of these sections during the exam, by student id. */
export async function participantsOf(
  db: Db,
  exam: Pick<Exam, 'academicYearId' | 'startsOn' | 'endsOn'>,
  sectionIds: string[],
): Promise<Map<string, Participant>> {
  const placements = await db.enrolment.findMany({
    where: {
      academicYearId: exam.academicYearId,
      classId: { in: sectionIds },
      enrolledOn: { lte: exam.endsOn },
      OR: [{ endedOn: null }, { endedOn: { gte: exam.startsOn } }],
    },
    include: { student: { select: { id: true, admissionNo: true, fullName: true } } },
    orderBy: { enrolledOn: 'asc' },
  });
  const byStudent = new Map<string, Participant>();
  for (const p of placements) {
    // Later placements replace earlier ones: the student counts in their latest section.
    byStudent.set(p.studentId, {
      studentId: p.studentId,
      admissionNo: p.student.admissionNo,
      fullName: p.student.fullName,
      rollNo: p.rollNo,
      classId: p.classId,
      branchId: p.branchId,
    });
  }
  return byStudent;
}

/** Roll number order, then name: the order of a register. */
export function byRoll(a: Participant, b: Participant): number {
  return (
    (a.rollNo ?? '~').localeCompare(b.rollNo ?? '~', undefined, { numeric: true }) ||
    a.fullName.localeCompare(b.fullName)
  );
}
