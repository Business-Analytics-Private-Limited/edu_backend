/**
 * WHO TAKES PART IN AN EXAM (ADR-0035).
 *
 * An exam is for a part of the structure (`exam.classId`: a year, group, stream or one section)
 * at one branch or at every branch (`exam.branchId` empty):
 *
 *   sectionsOf(tree, exam, level)   the active sections under that part, at that branch / all
 *   participantsOf(db, exam, ids)   the students placed in those sections during the exam
 *
 *   subjectsBySection(db, tree, sections, subjectIds)
 *                                   which of the exam's subjects each section has
 *
 * A student's placement counts when it is in the exam's academic year and its period overlaps
 * the exam dates. A student who changed section in that time keeps the latest placement.
 *
 * A section has a subject when the subject is attached to the section or to a class above it
 * (Academic → subjects of a class: Botany on "BiPC" = every BiPC section). Two fallbacks keep
 * half-finished set-ups working:
 *   - a section with no subjects attached at all (not set up yet) takes every subject of the exam;
 *   - a subject of the exam that no section of the exam has attached (an extra subject) is for
 *     every section.
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

/** Section id -> the subject ids (of the given ones) that the section has. See the top. */
export async function subjectsBySection(
  db: Db,
  tree: ClassTree,
  sections: ExamSection[],
  subjectIds: string[],
): Promise<Map<string, Set<string>>> {
  const links = await db.classSubject.findMany({ select: { classId: true, subjectId: true } });
  const ofExam = new Set(subjectIds);
  const subjectsOfClass = new Map<string, string[]>();
  for (const l of links) {
    subjectsOfClass.set(l.classId, [...(subjectsOfClass.get(l.classId) ?? []), l.subjectId]);
  }
  const result = new Map<string, Set<string>>();
  const attachedSomewhere = new Set<string>();
  for (const section of sections) {
    const attached = attachedSubjects(tree, section.id, subjectsOfClass);
    if (attached.length === 0) {
      // Not set up yet: every subject of the exam.
      result.set(section.id, new Set(subjectIds));
      continue;
    }
    const own = new Set(attached.filter((id) => ofExam.has(id)));
    own.forEach((id) => attachedSomewhere.add(id));
    result.set(section.id, own);
  }
  // Subjects no section has attached are for every section.
  const forEveryone = subjectIds.filter((id) => !attachedSomewhere.has(id));
  for (const set of result.values()) forEveryone.forEach((id) => set.add(id));
  return result;
}

/** The subjects attached to a section or to a class above it. */
export function attachedSubjects(
  tree: ClassTree,
  sectionId: string,
  subjectsOfClass: Map<string, string[]>,
): string[] {
  return [...new Set(tree.path(sectionId).flatMap((c) => subjectsOfClass.get(c.id) ?? []))];
}
