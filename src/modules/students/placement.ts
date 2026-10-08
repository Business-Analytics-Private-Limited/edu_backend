/**
 * Helpers shared by the student services: which students a user may see, and the rules for
 * placing a student in a section (an enrolment, ADR-0030).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { reachOf } from '../../common/scope';
import type { Db } from '../../prisma/prisma.service';
import { sectionLevel } from '../academic/presets';
import { assertBranchInUse, findOrganization } from '../organization/places-in-use';

/** A student's place: the branch they study (or last studied) at. */
export function placeOf(student: { branchId: string }) {
  return { branchId: student.branchId };
}

/** Students the user may see: of their branches, or all ("students.student.view"). */
export function visibleStudentsWhere(
  organizationId: string,
  actor: CurrentUser,
): Prisma.StudentWhereInput {
  const reach = reachOf(actor, 'students.student.view');
  if (reach.everywhere) return { organizationId };
  return { organizationId, branchId: { in: reach.branchIds } };
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

/**
 * A student can be placed in a SECTION (a class of the last level, in use, at the given branch)
 * for an academic year of the organization that isn't closed.
 */
export async function checkPlacement(
  db: Db,
  organizationId: string,
  branchId: string,
  wanted: { academicYearId: string; classId: string },
) {
  await assertBranchInUse(db, branchId);
  const year = await db.academicYear.findFirst({
    where: { id: wanted.academicYearId, organizationId },
  });
  if (!year) throw new BadRequestException("The academic year must be one of the organization's");
  if (year.status === 'CLOSED') throw new BadRequestException('That academic year is closed');

  const section = await db.class.findFirst({
    where: { id: wanted.classId, organizationId },
    include: { parent: true },
  });
  const organization = await findOrganization(db, organizationId);
  if (!section || section.level !== sectionLevel(organization.type)) {
    throw new BadRequestException(
      `Students are placed in a ${organization.levelNames.at(-1)?.toLowerCase() ?? 'section'}`,
    );
  }
  if (section.branchId !== branchId) {
    throw new BadRequestException("The section must be one of the branch's sections");
  }
  if (!section.isActive || !section.parent?.isActive) {
    throw new BadRequestException(`${section.name} is not in use`);
  }
  return { year, section };
}

/** "2026-06-01" -> Date; refuses a day before another day (e.g. a change before the placement). */
export function effectiveDay(value: string, notBefore?: Date): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (notBefore && date < notBefore) {
    throw new BadRequestException(
      `The date must be on or after ${notBefore.toISOString().slice(0, 10)}`,
    );
  }
  return date;
}

/** The day before a date: an enrolment that is left on `day` ends the day before. */
export function dayBefore(day: Date): Date {
  const d = new Date(day);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/**
 * An OUTGOING student loses portal access (ADR-0030): their own login, and the logins of parents
 * who have no other current child. Returns how many logins were closed.
 */
export async function closePortalLogins(db: Db, studentId: string): Promise<number> {
  const own = await db.user.updateMany({
    where: { studentId, status: 'ACTIVE' },
    data: { status: 'INACTIVE' },
  });
  const parents = await db.user.findMany({
    where: { kind: 'PARENT', status: 'ACTIVE', guardian: { students: { some: { studentId } } } },
    include: { guardian: { include: { students: { include: { student: true } } } } },
  });
  let closed = own.count;
  for (const parent of parents) {
    const otherCurrent = parent.guardian?.students.some(
      (s) => s.studentId !== studentId && s.student.status === 'ACTIVE',
    );
    if (otherCurrent) continue;
    await db.user.update({ where: { id: parent.id }, data: { status: 'INACTIVE' } });
    closed++;
  }
  return closed;
}
