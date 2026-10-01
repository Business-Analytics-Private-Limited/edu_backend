/**
 * PROMOTION and SHUFFLE: moving many students at once.
 *
 * PROMOTION (one campus, from one academic year to the next):
 *   1. preview: for every section with active students in the "from" year, a SUGGESTED section
 *      for the "to" year: the next class at the TOP level, then the same path by code, e.g.
 *        1st year > MPC > A            ->  2nd year > MPC > A
 *        Junior > MPC > EAMCET > A     ->  Senior > MPC > EAMCET > A
 *      No next top-level class (e.g. after 2nd year) = the students FINISH (become alumni).
 *      No class with the same codes = the user has to choose.
 *   2. apply: with the user's choices per section (a section, "graduate" or nothing = skip):
 *      the old enrolment becomes PROMOTED (or COMPLETED for those who finish), a new enrolment
 *      is created in the "to" year, roll numbers kept if asked, and the students' batches can
 *      move to a new stage (e.g. Junior -> Senior). Students already placed in the "to" year
 *      are left alone.
 *
 * UNDO: every applied promotion is recorded (promotion_runs) and can be undone once, as long as
 * nothing changed since for its students.
 *
 * SHUFFLE: moving chosen students to another section of the same campus in the same year.
 *
 * Permissions at the campus: "students.enrolment.promote" / "students.enrolment.transfer".
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Class } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ApplyPromotionDto, MoveStudentsDto, PromotionQuery } from './dto/student.dto';
import { checkPlacement, findCampus } from './placement';

/** One student changed by a promotion (kept in promotion_runs.items for undo). */
interface RunItem {
  studentId: string;
  oldEnrolmentId: string;
  /** null = the student finished (became alumni). */
  newEnrolmentId: string | null;
}

/** Where the students of one section go. */
type Suggestion =
  { kind: 'section'; sectionId: string } | { kind: 'graduate' } | { kind: 'choose' };

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  preview(organizationId: string, query: PromotionQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const { campus, fromYear, toYear } = await this.checkYears(db, organizationId, query, actor);
      const classes = await db.class.findMany({ where: { campusId: campus.id } });
      const levels = await db.classLevel.count({ where: { institutionId: campus.institutionId } });
      const tree = new ClassTree(classes);

      const enrolments = await db.enrolment.findMany({
        where: {
          academicYearId: fromYear.id,
          campusId: campus.id,
          status: 'ACTIVE',
          student: { status: 'ACTIVE' },
        },
        include: {
          student: { select: { id: true, fullName: true, admissionNo: true } },
        },
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

      // One row per "from" section, in tree order.
      const bySection = new Map<string, typeof enrolments>();
      for (const e of enrolments) {
        bySection.set(e.classId, [...(bySection.get(e.classId) ?? []), e]);
      }
      const rows = [...bySection.entries()]
        .map(([sectionId, list]) => ({
          from: { id: sectionId, label: tree.label(sectionId) },
          suggestion: tree.suggest(sectionId),
          students: list
            .filter((e) => !alreadyPlaced.has(e.studentId))
            .map((e) => ({ ...e.student, rollNo: e.rollNo })),
          alreadyPlaced: list.filter((e) => alreadyPlaced.has(e.studentId)).length,
        }))
        .sort((a, b) => a.from.label.localeCompare(b.from.label));

      return {
        campus: { id: campus.id, name: campus.name },
        fromYear: { id: fromYear.id, name: fromYear.name },
        toYear: { id: toYear.id, name: toYear.name },
        rows,
        // Every section of the campus, as choices for "to".
        sections: classes
          .filter((c) => c.level === levels && c.isActive)
          .map((c) => ({ id: c.id, label: tree.label(c.id) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      };
    });
  }

  apply(organizationId: string, dto: ApplyPromotionDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const { campus, fromYear, toYear } = await this.checkYears(db, organizationId, dto, actor);
      const place = { institutionId: campus.institutionId, campusId: campus.id };
      const today = new Date();
      let promoted = 0;
      let graduated = 0;
      const batchIds = new Set<string>();
      // What this promotion changes, so it can be undone (see undo()).
      const items: RunItem[] = [];

      for (const choice of dto.mapping) {
        if (!choice.toSectionId && !choice.graduate) continue; // skip this section
        if (choice.toSectionId) {
          await checkPlacement(db, place, {
            academicYearId: toYear.id,
            classId: choice.toSectionId,
          });
        }
        const enrolments = await db.enrolment.findMany({
          where: {
            academicYearId: fromYear.id,
            campusId: campus.id,
            classId: choice.fromSectionId,
            status: 'ACTIVE',
            student: { status: 'ACTIVE', enrolments: { none: { academicYearId: toYear.id } } },
          },
          include: { student: { select: { id: true, batchId: true, status: true } } },
        });

        for (const e of enrolments) {
          if (e.student.batchId) batchIds.add(e.student.batchId);
          if (choice.graduate) {
            await db.enrolment.update({ where: { id: e.id }, data: { status: 'COMPLETED' } });
            await db.student.update({ where: { id: e.studentId }, data: { status: 'ALUMNI' } });
            await db.studentStatusChange.create({
              data: {
                organizationId,
                studentId: e.studentId,
                fromStatus: 'ACTIVE',
                toStatus: 'ALUMNI',
                effectiveOn: fromYear.endsOn,
                reason: `Finished (${fromYear.name})`,
                changedBy: actor.id,
              },
            });
            items.push({ studentId: e.studentId, oldEnrolmentId: e.id, newEnrolmentId: null });
            graduated++;
          } else {
            await db.enrolment.update({ where: { id: e.id }, data: { status: 'PROMOTED' } });
            const created = await db.enrolment.create({
              data: {
                organizationId,
                studentId: e.studentId,
                academicYearId: toYear.id,
                institutionId: campus.institutionId,
                campusId: campus.id,
                classId: choice.toSectionId!,
                rollNo: dto.keepRollNumbers ? e.rollNo : null,
                enrolledOn: today,
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

      // The batches' stages before this promotion, to put them back on undo.
      const batchStages = dto.batchStage
        ? (
            await db.batch.findMany({
              where: { id: { in: [...batchIds] } },
              select: { id: true, stage: true },
            })
          ).map((b) => ({ batchId: b.id, stage: b.stage }))
        : [];
      if (dto.batchStage && batchIds.size > 0) {
        await db.batch.updateMany({
          where: { id: { in: [...batchIds] }, institutionId: campus.institutionId },
          data: { stage: dto.batchStage.trim() },
        });
      }
      await this.audit.log(db, actor, {
        action: 'promote',
        entity: 'students',
        ...place,
        details: {
          from: fromYear.name,
          to: toYear.name,
          promoted,
          graduated,
          batchStage: dto.batchStage,
        },
      });
      const run =
        items.length > 0
          ? await db.promotionRun.create({
              data: {
                organizationId,
                institutionId: campus.institutionId,
                campusId: campus.id,
                fromYearId: fromYear.id,
                toYearId: toYear.id,
                promoted,
                graduated,
                items: items as unknown as Prisma.InputJsonValue,
                batchStages,
                createdBy: actor.id,
              },
            })
          : null;
      return {
        promoted,
        graduated,
        batchesMoved: dto.batchStage ? batchIds.size : 0,
        runId: run?.id ?? null,
      };
    });
  }

  /** The promotions applied on a campus, newest first (for the "Undo" list). */
  listRuns(organizationId: string, campusId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const campus = await findCampus(db, organizationId, campusId);
      assertCan(actor, 'students.enrolment.promote', {
        institutionId: campus.institutionId,
        campusId: campus.id,
      });
      const runs = await db.promotionRun.findMany({
        where: { campusId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      const years = await db.academicYear.findMany({
        where: { id: { in: runs.flatMap((r) => [r.fromYearId, r.toYearId]) } },
        select: { id: true, name: true },
      });
      const name = new Map(years.map((y) => [y.id, y.name]));
      return runs.map(({ items: _items, batchStages: _stages, ...run }) => ({
        ...run,
        fromYear: name.get(run.fromYearId) ?? '',
        toYear: name.get(run.toYearId) ?? '',
      }));
    });
  }

  /**
   * Undoes a promotion: the new sections go, the old ones are active again, students who
   * finished are active again, batches get their old stage back. All or nothing, and refused
   * if anything changed since (a student was moved on, left, or changed campus).
   */
  undo(organizationId: string, runId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const run = await db.promotionRun.findFirst({ where: { id: runId, organizationId } });
      if (!run) throw new NotFoundException('Promotion not found');
      const place = { institutionId: run.institutionId, campusId: run.campusId };
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
          student?.campusId === run.campusId &&
          (item.newEnrolmentId
            ? created?.status === 'ACTIVE' && student?.status === 'ACTIVE'
            : student?.status === 'ALUMNI');
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
              fromStatus: 'ALUMNI',
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
      for (const { batchId, stage } of run.batchStages as unknown as {
        batchId: string;
        stage: string;
      }[]) {
        await db.batch.update({ where: { id: batchId }, data: { stage } });
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

  /** Shuffle: chosen students of one year to another section of the same campus. */
  move(organizationId: string, dto: MoveStudentsDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const section = await db.class.findFirst({ where: { id: dto.toSectionId, organizationId } });
      if (!section) throw new NotFoundException('Section not found');
      const place = { institutionId: section.institutionId, campusId: section.campusId };
      assertCan(actor, 'students.enrolment.transfer', place);
      await checkPlacement(db, place, { academicYearId: dto.academicYearId, classId: section.id });

      const enrolments = await db.enrolment.findMany({
        where: {
          academicYearId: dto.academicYearId,
          studentId: { in: dto.studentIds },
          campusId: section.campusId,
          status: 'ACTIVE',
        },
      });
      if (enrolments.length !== dto.studentIds.length) {
        throw new BadRequestException(
          'Every student must have an active section on this campus in that academic year',
        );
      }
      // Roll numbers belong to a section, so they are cleared when moving several at once.
      await db.enrolment.updateMany({
        where: { id: { in: enrolments.map((e) => e.id) } },
        data: { classId: section.id, rollNo: null },
      });
      await this.audit.log(db, actor, {
        action: 'move students',
        entity: 'students',
        ...place,
        details: { to: section.name, students: enrolments.length },
      });
      return { moved: enrolments.length };
    });
  }

  /** The campus and two years: same institution, "to" not closed and later than "from". */
  private async checkYears(
    db: Db,
    organizationId: string,
    q: { campusId: string; fromYearId: string; toYearId: string },
    actor: CurrentUser,
  ) {
    const campus = await findCampus(db, organizationId, q.campusId);
    assertCan(actor, 'students.enrolment.promote', {
      institutionId: campus.institutionId,
      campusId: campus.id,
    });
    const [fromYear, toYear] = await Promise.all([
      db.academicYear.findFirst({
        where: { id: q.fromYearId, institutionId: campus.institutionId },
      }),
      db.academicYear.findFirst({ where: { id: q.toYearId, institutionId: campus.institutionId } }),
    ]);
    if (!fromYear || !toYear) {
      throw new BadRequestException("Both academic years must be the campus's institution's");
    }
    if (toYear.status === 'CLOSED') throw new BadRequestException(`${toYear.name} is closed`);
    if (toYear.startsOn <= fromYear.startsOn) {
      throw new BadRequestException('Students are promoted to a LATER academic year');
    }
    return { campus, fromYear, toYear };
  }
}

/** A campus's classes, to name sections ("1st year › MPC › A") and suggest the next one. */
class ClassTree {
  private readonly byId: Map<string, Class>;

  constructor(private readonly classes: Class[]) {
    this.byId = new Map(classes.map((c) => [c.id, c]));
  }

  path(id: string): Class[] {
    const c = this.byId.get(id);
    return c ? [...(c.parentId ? this.path(c.parentId) : []), c] : [];
  }

  label(id: string): string {
    return this.path(id)
      .map((c) => c.name)
      .join(' › ');
  }

  /** The next class at the top level, then the same codes below it. */
  suggest(sectionId: string): Suggestion {
    const [top, ...rest] = this.path(sectionId);
    if (!top) return { kind: 'choose' };
    const tops = this.classes
      .filter((c) => c.level === 1 && c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const next = tops[tops.findIndex((c) => c.id === top.id) + 1];
    if (!next) return { kind: 'graduate' };
    let current: Class | undefined = next;
    for (const step of rest) {
      current = this.classes.find(
        (c) => c.parentId === current!.id && c.code === step.code && c.isActive,
      );
      if (!current) return { kind: 'choose' };
    }
    return { kind: 'section', sectionId: current.id };
  }
}
