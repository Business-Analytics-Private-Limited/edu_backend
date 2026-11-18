/**
 * WHICH GROUPS EACH BRANCH RUNS (Intermediate, ADR-0032).
 *
 * The organization switches groups on (MPC, BiPC, CEC, HEC: Academic → Structure); each branch
 * then runs some of them (`branch_groups`), e.g. NAD: MPC + BiPC, Madhurawada: MPC only.
 * Sections at a branch can only be made under a group it runs.
 *
 *   await giveBranchAllGroups(db, organization, branchId)   a new branch runs every group
 *   await organizationGroupCodes(db, organizationId)         ["MPC", "BIPC"]
 *   groupCodeOf(tree, classId)                               "MPC" for Junior › MPC › JEE Mains
 */
import type { Organization } from '@prisma/client';
import type { Db } from '../../prisma/prisma.service';
import type { ClassTree } from './class-tree';

/** The level of groups in an Intermediate structure (Year = 1, Group = 2, Stream = 3). */
export const GROUP_LEVEL = 2;

/** The groups the organization has switched on (their codes), Intermediate only. */
export async function organizationGroupCodes(db: Db, organizationId: string): Promise<string[]> {
  const groups = await db.class.findMany({
    where: { organizationId, level: GROUP_LEVEL, branchId: null },
    select: { code: true },
  });
  return [...new Set(groups.map((g) => g.code))];
}

/** A new branch of an Intermediate organization runs every group the organization has. */
export async function giveBranchAllGroups(
  db: Db,
  organization: Pick<Organization, 'id' | 'type'>,
  branchId: string,
) {
  if (organization.type !== 'INTERMEDIATE') return;
  const codes = await organizationGroupCodes(db, organization.id);
  if (codes.length === 0) return;
  await db.branchGroup.createMany({
    data: codes.map((groupCode) => ({ organizationId: organization.id, branchId, groupCode })),
    skipDuplicates: true,
  });
}

/** The code of the group a class sits in (or is), e.g. "MPC"; null above the group level. */
export function groupCodeOf(tree: ClassTree, classId: string): string | null {
  return tree.path(classId).find((c) => c.level === GROUP_LEVEL)?.code ?? null;
}
