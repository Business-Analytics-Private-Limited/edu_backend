/**
 * Small helpers shared by the student services: which students a user may see, and the checks
 * for putting a student in a section / batch.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { reachOf } from '../../common/scope';
import type { Db } from '../../prisma/prisma.service';

/** A student's place: their institution and campus. */
export function placeOf(student: { institutionId: string; campusId: string }) {
  return { institutionId: student.institutionId, campusId: student.campusId };
}

/** Students the user may see: of their campuses / institutions, or all ("students.student.view"). */
export function visibleStudentsWhere(
  organizationId: string,
  actor: CurrentUser,
): Prisma.StudentWhereInput {
  const reach = reachOf(actor, 'students.student.view');
  if (reach.everywhere) return { organizationId };
  return {
    organizationId,
    OR: [{ campusId: { in: reach.campusIds } }, { institutionId: { in: reach.institutionIds } }],
  };
}

/** The student, or 404 if they don't exist or the user may not see them. */
export async function findVisibleStudent(
  db: Db,
  organizationId: string,
  id: string,
  actor: CurrentUser,
) {
  const student = await db.student.findFirst({
    where: { ...visibleStudentsWhere(organizationId, actor), id },
  });
  if (!student) throw new NotFoundException('Student not found');
  return student;
}

export async function findCampus(db: Db, organizationId: string, campusId: string) {
  const campus = await db.campus.findFirst({ where: { id: campusId, organizationId } });
  if (!campus) throw new NotFoundException('Campus not found');
  return campus;
}

/** The batch must belong to the student's institution. */
export async function checkBatch(db: Db, institutionId: string, batchId: string) {
  const batch = await db.batch.findFirst({ where: { id: batchId, institutionId } });
  if (!batch) throw new BadRequestException("The batch must be one of the institution's batches");
  return batch;
}

/**
 * A student can be placed in a SECTION (a class of the institution's last level, in use, on the
 * student's campus) for an academic year of the institution that isn't closed.
 */
export async function checkPlacement(
  db: Db,
  place: { institutionId: string; campusId: string },
  wanted: { academicYearId: string; classId: string },
) {
  const year = await db.academicYear.findFirst({
    where: { id: wanted.academicYearId, institutionId: place.institutionId },
  });
  if (!year)
    throw new BadRequestException("The academic year must be one of the institution's years");
  if (year.status === 'CLOSED') throw new BadRequestException('That academic year is closed');

  const section = await db.class.findFirst({
    where: { id: wanted.classId, campusId: place.campusId },
  });
  if (!section)
    throw new BadRequestException("The section must be a class on the student's campus");
  if (!section.isActive) throw new BadRequestException('That class is not in use');
  const levels = await db.classLevel.count({ where: { institutionId: place.institutionId } });
  if (section.level !== levels) {
    throw new BadRequestException(
      'Students are placed in a class of the last level (a section), not in a class above it',
    );
  }
  return { year, section };
}

/** The class and every class below it (to list the students of e.g. a whole group). */
export async function descendantClassIds(db: Db, classId: string): Promise<string[]> {
  const ids = [classId];
  let frontier = [classId];
  while (frontier.length > 0) {
    const children = await db.class.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    ids.push(...frontier);
  }
  return ids;
}
