/**
 * PROMOTION: moving a branch's students from one academic year to the next (ADR-0030).
 *
 *   1. preview: for every section with current students in the "from" year, a SUGGESTED
 *      section for the "to" year. It follows the PROGRESSION of the year-level class (presets.ts):
 *        Junior > MPC > JEE Mains > JEE-A   ->  Senior > MPC > JEE Mains > JEE-A
 *        Class 9 > A                        ->  Class 10 > A
 *        B.Tech > CSE > 1st Year > A        ->  B.Tech > CSE > 2nd Year > A
 *      i.e. the year's `next` class, then the same codes below it, then the section with the
 *      same code in the same branch. No `next` (Class 10, Senior, Long Term, the final year) =
 *      the students COMPLETE. Nothing matching = the user chooses.
 *   2. apply: with the user's choices per section (a section, "complete", or nothing = skip):
 *      the old placement becomes PROMOTED (or COMPLETED), a new placement is created in the "to"
 *      year (roll numbers kept if asked); students who complete become outgoing (COMPLETED).
 *      Students already placed in the "to" year are left alone.
 *
 * Nothing is ever overwritten: the old year's placements stay as they were.
 * UNDO: every applied promotion is recorded (promotion_runs) and can be undone once, as long as
 * nothing changed since for its students.
 *
 * Permission at the branch: "students.enrolment.promote".
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { byOrder, ClassTree } from '../academic/class-tree';
import { PRESETS } from '../academic/presets';
import { AuditService } from '../audit/audit.service';
import { findBranch, findOrganization } from '../organization/places-in-use';
import { ApplyPromotionDto, PromotionQuery } from './dto/student.dto';
import { checkPlacement, closePortalLogins } from './placement';

/** One student changed by a promotion (kept in promotion_runs.items for undo). */
interface RunItem {
  studentId: string;
  oldEnrolmentId: string;
  /** null = the student completed. */
  newEnrolmentId: string | null;
}

/** Where the students of one section go. */
type Suggestion =
  { kind: 'section'; sectionId: string } | { kind: 'complete' } | { kind: 'choose' };

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  preview(organizationId: string, query: PromotionQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const { branch, fromYear, toYear } = await this.checkYears(db, organizationId, query, actor);
      const tree = await ClassTree.load(db, organizationId);
      const organization = await findOrganization(db, organizationId);
      const yearLevel = PRESETS[organization.type].yearLevel;

      const enrolments = await db.enrolment.findMany({
        where: {
          academicYearId: fromYear.id,
          branchId: branch.id,
          status: 'ACTIVE',
          student: { status: 'ACTIVE' },
        },
        include: { student: { select: { id: true, fullName: true, admissionNo: true } } },
        orderBy: [{ rollNo: 'asc' }],
      });
      const alreadyPlaced = new Set(
        (
          await db.enrolment.findMany({
            where: {
              academicYearId: toYear.id,
              studentId: { in: enrolments.map((e) => e.studentId) },
            },
            select: { studentId: true },
          })
        ).map((e) => e.studentId),
      );

      // One row per "from" section.
      const bySection = new Map<string, typeof enrolments>();
      for (const e of enrolments) {
        bySection.set(e.classId, [...(bySection.get(e.classId) ?? []), e]);
      }
      const rows = [...bySection.entries()]
        .map(([sectionId, list]) => ({
          from: { id: sectionId, label: tree.label(sectionId) },
          suggestion: suggest(tree, sectionId, yearLevel),
          students: list
            .filter((e) => !alreadyPlaced.has(e.studentId))
            .map((e) => ({ ...e.student, rollNo: e.rollNo })),
          alreadyPlaced: list.filter((e) => alreadyPlaced.has(e.studentId)).length,
        }))
        .sort((a, b) => a.from.label.localeCompare(b.from.label));

      return {
        branch: { id: branch.id, name: branch.name },
        fromYear: { id: fromYear.id, name: fromYear.name },
        toYear: { id: toYear.id, name: toYear.name },
        rows,
        // Every section of the branch in use, as choices for "to".
        sections: tree.classes
          .filter((c) => c.branchId === branch.id && c.isActive)
          .map((c) => ({ id: c.id, label: tree.label(c.id) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      };
    });
  }

  apply(organizationId: string, dto: ApplyPromotionDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const { branch, fromYear, toYear } = await this.checkYears(db, organizationId, dto, actor);
      const place = { branchId: branch.id };
      let promoted = 0;
      let completed = 0;
      // What this promotion changes, so it can be undone (see undo()).
      const items: RunItem[] = [];

      for (const choice of dto.mapping) {
        if (!choice.toSectionId && !choice.complete) continue; // skip this section
        if (choice.toSectionId) {
          await checkPlacement(db, organizationId, branch.id, {
            academicYearId: toYear.id,
            classId: choice.toSectionId,
          });
        }
        const enrolments = await db.enrolment.findMany({
          where: {
            academicYearId: fromYear.id,
            branchId: branch.id,
            classId: choice.fromSectionId,
            status: 'ACTIVE',
            student: { status: 'ACTIVE', enrolments: { none: { academicYearId: toYear.id } } },
          },
        });

        for (const e of enrolments) {
          if (choice.complete) {
            await db.enrolment.update({ where: { id: e.id }, data: { status: 'COMPLETED' } });
            await db.student.update({ where: { id: e.studentId }, data: { status: 'COMPLETED' } });
            await db.studentStatusChange.create({
              data: {
                organizationId,
                studentId: e.studentId,
                fromStatus: 'ACTIVE',
                toStatus: 'COMPLETED',
                effectiveOn: fromYear.endsOn,
                reason: `Completed (${fromYear.name})`,
                changedBy: actor.id,
              },
            });
            await closePortalLogins(db, e.studentId);
            items.push({ studentId: e.studentId, oldEnrolmentId: e.id, newEnrolmentId: null });
            completed++;
          } else {
            await db.enrolment.update({ where: { id: e.id }, data: { status: 'PROMOTED' } });
            const created = await db.enrolment.create({
              data: {
                organizationId,
                studentId: e.studentId,
                academicYearId: toYear.id,
                branchId: branch.id,
                classId: choice.toSectionId!,
                rollNo: dto.keepRollNumbers ? e.rollNo : null,
                enrolledOn: toYear.startsOn,
                reason: `Promoted from ${fromYear.name}`,
              },
            });
            items.push({
              studentId: e.studentId,
              oldEnrolmentId: e.id,
              newEnrolmentId: created.id,
            });
            promoted++;
          }
        }
      }

      await this.audit.log(db, actor, {
        action: 'promote',
        entity: 'students',
        ...place,
        details: { from: fromYear.name, to: toYear.name, promoted, completed },
      });
      const run =
        items.length > 0
          ? await db.promotionRun.create({
              data: {
                organizationId,
                branchId: branch.id,
                fromYearId: fromYear.id,
                toYearId: toYear.id,
                promoted,
                completed,
                items: items as unknown as Prisma.InputJsonValue,
                createdBy: actor.id,
              },
            })
          : null;
      return { promoted, completed, runId: run?.id ?? null };
    });
  }

  /** The promotions applied at a branch, newest first (for the "Undo" list). */
  listRuns(organizationId: string, branchId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await findBranch(db, organizationId, branchId);
      assertCan(actor, 'students.enrolment.promote', { branchId });
      const runs = await db.promotionRun.findMany({
        where: { branchId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      const years = await db.academicYear.findMany({
        where: { id: { in: runs.flatMap((r) => [r.fromYearId, r.toYearId]) } },
        select: { id: true, name: true },
      });
      const name = new Map(years.map((y) => [y.id, y.name]));
      return runs.map(({ items, ...run }) => ({
        ...run,
        students: (items as unknown as RunItem[]).length,
        fromYear: name.get(run.fromYearId) ?? '',
        toYear: name.get(run.toYearId) ?? '',
      }));
    });
  }

  /**
   * Undoes a promotion: the new placements go, the old ones are current again, students who
   * completed are current again. All or nothing, and refused if anything changed since (a
   * student was moved, left, or changed branch). Portal logins closed on completion stay closed.
   */
  undo(organizationId: string, runId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const run = await db.promotionRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new NotFoundException('Promotion not found');
      const place = { branchId: run.branchId };
      assertCan(actor, 'students.enrolment.promote', place);
      if (run.undoneAt) throw new BadRequestException('This promotion was already undone');

      const items = run.items as unknown as RunItem[];
      const changed: string[] = [];
      for (const item of items) {
        const [old, created, student] = await Promise.all([
          db.enrolment.findUnique({ where: { id: item.oldEnrolmentId } }),
          item.newEnrolmentId
            ? db.enrolment.findUnique({ where: { id: item.newEnrolmentId } })
            : null,
          db.student.findUnique({ where: { id: item.studentId } }),
        ]);
        const expectedOld = item.newEnrolmentId ? 'PROMOTED' : 'COMPLETED';
        const ok =
          old?.status === expectedOld &&
          student?.branchId === run.branchId &&
          (item.newEnrolmentId
            ? created?.status === 'ACTIVE' && student?.status === 'ACTIVE'
            : student?.status === 'COMPLETED');
        if (!ok) changed.push(student?.fullName ?? 'a deleted student');
      }
      if (changed.length > 0) {
        throw new BadRequestException(
          `Can't undo: ${changed.length} student(s) changed since (e.g. ${changed.slice(0, 3).join(', ')})`,
        );
      }

      const today = new Date();
      for (const item of items) {
        if (item.newEnrolmentId) {
          await db.enrolment.delete({ where: { id: item.newEnrolmentId } });
        } else {
          await db.student.update({ where: { id: item.studentId }, data: { status: 'ACTIVE' } });
          await db.studentStatusChange.create({
            data: {
              organizationId,
              studentId: item.studentId,
              fromStatus: 'COMPLETED',
              toStatus: 'ACTIVE',
              effectiveOn: today,
              reason: 'Promotion undone',
              changedBy: actor.id,
            },
          });
        }
        await db.enrolment.update({
          where: { id: item.oldEnrolmentId },
          data: { status: 'ACTIVE' },
        });
      }
      await db.promotionRun.update({
        where: { id: runId },
        data: { undoneAt: today, undoneBy: actor.id },
      });
      await this.audit.log(db, actor, {
        action: 'undo promotion',
        entity: 'students',
        entityId: runId,
        ...place,
        details: { students: items.length },
      });
      return { undone: items.length };
    });
  }

  /** The branch and two years: "to" not closed and later than "from". */
  private async checkYears(
    db: Db,
    organizationId: string,
    q: { branchId: string; fromYearId: string; toYearId: string },
    actor: CurrentUser,
  ) {
    const branch = await findBranch(db, organizationId, q.branchId);
    assertCan(actor, 'students.enrolment.promote', { branchId: branch.id });
    const [fromYear, toYear] = await Promise.all([
      db.academicYear.findFirst({ where: { id: q.fromYearId, organizationId } }),
      db.academicYear.findFirst({ where: { id: q.toYearId, organizationId } }),
    ]);
    if (!fromYear || !toYear) {
      throw new BadRequestException("Both academic years must be the organization's");
    }
    if (toYear.status === 'CLOSED') throw new BadRequestException(`${toYear.name} is closed`);
    if (toYear.startsOn <= fromYear.startsOn) {
      throw new BadRequestException('Students are promoted to a LATER academic year');
    }
    return { branch, fromYear, toYear };
  }
}

/**
 * Where a section's students go: the year-level class's `next`, then the same codes below it,
 * then the section with the same code in the same branch.
 */
function suggest(tree: ClassTree, sectionId: string, yearLevel: number): Suggestion {
  const path = tree.path(sectionId);
  const section = path.at(-1);
  const yearIndex = path.findIndex((c) => c.level === yearLevel);
  if (!section || yearIndex < 0) return { kind: 'choose' };
  const nextYear = path[yearIndex].nextClassId ? tree.get(path[yearIndex].nextClassId!) : null;
  if (!nextYear) return { kind: 'complete' };

  let current = nextYear;
  for (const step of path.slice(yearIndex + 1, -1)) {
    const child = tree.children(current.id).find((c) => c.code === step.code && c.isActive);
    if (!child) return { kind: 'choose' };
    current = child;
  }
  const target = tree
    .children(current.id)
    .filter((c) => c.branchId === section.branchId && c.isActive)
    .sort(byOrder)
    .find((c) => c.code === section.code);
  return target ? { kind: 'section', sectionId: target.id } : { kind: 'choose' };
}
