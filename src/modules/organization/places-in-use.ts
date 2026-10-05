/**
 * Inactive campuses and institutions (ADR-0026). A campus or institution that closes is made
 * INACTIVE instead of being deleted: its records (students, attendance, documents, audit) stay
 * and can still be read, but nothing NEW may happen there.
 *
 * Every service that starts new work at a place calls one of these first, e.g. admitting a
 * student, creating a class, marking attendance, giving someone a role, adding a holiday:
 *
 *   await assertCampusInUse(db, campus.id);
 *
 * A campus is in use only when both the campus and its institution are ACTIVE.
 */
import { BadRequestException } from '@nestjs/common';
import type { Db } from '../../prisma/prisma.service';

export async function assertCampusInUse(db: Db, campusId: string): Promise<void> {
  const campus = await db.campus.findUnique({
    where: { id: campusId },
    include: { institution: { select: { name: true, status: true } } },
  });
  if (!campus) return; // the caller reports "not found" itself
  if (campus.institution.status !== 'ACTIVE') {
    throw new BadRequestException(`${campus.institution.name} is inactive`);
  }
  if (campus.status !== 'ACTIVE') {
    throw new BadRequestException(
      `Campus ${campus.name} is inactive; the Organization admin can activate it again`,
    );
  }
}

export async function assertInstitutionInUse(db: Db, institutionId: string): Promise<void> {
  const institution = await db.institution.findUnique({ where: { id: institutionId } });
  if (institution && institution.status !== 'ACTIVE') {
    throw new BadRequestException(`${institution.name} is inactive`);
  }
}

/** How many ACTIVE students still study at the place: a place with students can't close. */
export function activeStudentCount(db: Db, where: { campusId?: string; institutionId?: string }) {
  return db.student.count({ where: { ...where, status: 'ACTIVE' } });
}
