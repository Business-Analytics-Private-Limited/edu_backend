/**
 * Branches in use (ADR-0026, ADR-0030). A branch that closes is made INACTIVE instead of being
 * deleted: its records (students, attendance, documents, audit) stay and can still be read, but
 * nothing NEW may happen there.
 *
 * Every service that starts new work at a branch calls assertBranchInUse first, e.g. admitting
 * a student, creating a section, marking attendance, giving someone a role, adding a holiday:
 *
 *   const branch = await findBranch(db, organizationId, dto.branchId);
 *   await assertBranchInUse(db, branch.id);
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Db } from '../../prisma/prisma.service';

/** The branch, or 404 if it doesn't exist in this organization. */
export async function findBranch(db: Db, organizationId: string, branchId: string) {
  const branch = await db.branch.findFirst({ where: { id: branchId, organizationId } });
  if (!branch) throw new NotFoundException('Branch not found');
  return branch;
}

export async function assertBranchInUse(db: Db, branchId: string): Promise<void> {
  const branch = await db.branch.findUnique({ where: { id: branchId } });
  if (!branch) return; // the caller reports "not found" itself
  if (branch.status !== 'ACTIVE') {
    throw new BadRequestException(
      `Branch ${branch.name} is inactive; EduPlatform can activate it again`,
    );
  }
}

/** How many current (ACTIVE) students study at the branch: a branch with students can't close. */
export function activeStudentCount(db: Db, branchId: string) {
  return db.student.count({ where: { branchId, status: 'ACTIVE' } });
}

/** The organization with its type and settings (every academic rule needs them). */
export async function findOrganization(db: Db, organizationId: string) {
  const organization = await db.organization.findUnique({ where: { id: organizationId } });
  if (!organization) throw new NotFoundException('Organization not found');
  return organization;
}
