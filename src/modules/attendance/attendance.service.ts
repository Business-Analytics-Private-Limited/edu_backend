/**
 * ATTENDANCE: marking a section's register for a day, changes and corrections, the daily
 * overview of a branch, and reports.
 *
 * Rules (ADR-0021, ADR-0030):
 *   - attendance is marked per SECTION (a class of the last level) and DAY, at the section's
 *     branch ("attendance.record.mark");
 *   - a section's register on a day = the students whose placement in that section covers that
 *     day (a student who changed section on 15 July is in the old register until 14 July);
 *   - only on a working day (not a weekly off day, not a holiday), never in the future, inside
 *     an academic year that isn't closed, and not further back than the organization's
 *     correction window (default 7 days);
 *   - the first marking of a day covers every student of the section;
 *   - records are never overwritten: a change makes a new version pointing to the old one.
 *     Changing TODAY's attendance needs "mark"; changing a past day is a correction: it needs
 *     "attendance.record.correct" and a reason;
 *   - one current record per student and day: a student moved to another section on a day
 *     that was already marked in the old one keeps that mark. The new section's register shows
 *     it ("markedIn"), and saving that register moves the record there as a new version. That
 *     alone is no correction; changing the status is;
 *   - "today" is the date in the organization's time zone.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AttendanceSettingsDto,
  DailySummaryQuery,
  MarkSectionDto,
  RangeQuery,
  SectionReportQuery,
} from './dto/attendance.dto';
import {
  countWorkingDays,
  daysBefore,
  isoDay,
  isTimeZone,
  parseDay,
  todayIn,
  workingDay,
} from './working-days';
import { ClassTree } from '../academic/class-tree';
import { sectionLevel } from '../academic/presets';
import { assertBranchInUse, findBranch, findOrganization } from '../organization/places-in-use';

type Counts = Record<AttendanceStatus, number>;
type Entry = MarkSectionDto['entries'][number];
const emptyCounts = (): Counts => ({ PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, ON_LEAVE: 0 });

/**
 * Attendance percentage: present and late count fully, a half day half; days on leave don't
 * count against the student. null when there is nothing to count yet.
 */
export function percentage(c: Counts): number | null {
  const counted = c.PRESENT + c.LATE + c.HALF_DAY + c.ABSENT;
  if (counted === 0) return null;
  return Math.round(((c.PRESENT + c.LATE + c.HALF_DAY / 2) / counted) * 1000) / 10;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- The register of one section on one day ------------------------------------------------

  roster(organizationId: string, classId: string, day: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const ctx = await this.context(db, organizationId, classId, day);
      if (
        !can(actor, 'attendance.record.view', ctx.place) &&
        !can(actor, 'attendance.record.mark', ctx.place)
      ) {
        throw new NotFoundException('Section not found');
      }
      const students = ctx.year
        ? await this.studentsOf(db, ctx.section.id, ctx.year.id, ctx.date)
        : [];
      const { records, byStudent } = await this.recordsOfDay(db, ctx, students);
      const lastMarked = records.reduce<(typeof records)[number] | null>(
        (latest, r) => (!latest || r.createdAt > latest.createdAt ? r : latest),
        null,
      );
      return {
        date: day,
        today: ctx.today,
        section: {
          id: ctx.section.id,
          name: ctx.section.name,
          label: ctx.label,
          branchId: ctx.section.branchId,
        },
        academicYear: ctx.year ? { id: ctx.year.id, name: ctx.year.name } : null,
        workingDay: ctx.working.working,
        reason: ctx.working.reason ?? null,
        marked: records.length > 0,
        lastMarkedBy: lastMarked
          ? { name: lastMarked.markedByName, at: lastMarked.createdAt }
          : null,
        /** Why this day can't be marked / changed here, or null if it can. */
        blocked: this.blockedReason(ctx),
        students: students.map((s) => {
          const r = byStudent.get(s.studentId);
          return {
            ...s,
            status: r?.status ?? null,
            remark: r?.remark ?? null,
            corrected: r?.correctedFromId !== null && r?.correctedFromId !== undefined,
            // Marked that day in the section they moved from (saving this register moves it here).
            markedIn: r && r.classId !== classId ? ctx.tree.label(r.classId) : null,
          };
        }),
      };
    });
  }

  /** Marks (or changes) a section's attendance for a day. */
  mark(organizationId: string, dto: MarkSectionDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const ctx = await this.context(db, organizationId, dto.classId, dto.date);
      assertCan(actor, 'attendance.record.mark', ctx.place);
      await assertBranchInUse(db, ctx.place.branchId);
      const blocked = this.blockedReason(ctx);
      if (blocked) throw new BadRequestException(blocked);
      const beyondWindow =
        dto.date < daysBefore(ctx.today, ctx.organization.attendanceCorrectionDays);
      if (beyondWindow && !can(actor, 'attendance.policy.update', ctx.place)) {
        throw new BadRequestException(
          `Days more than ${ctx.organization.attendanceCorrectionDays} day(s) back can no longer be marked or changed`,
        );
      }

      const students = await this.studentsOf(db, ctx.section.id, ctx.year!.id, ctx.date);
      const inSection = new Set(students.map((s) => s.studentId));
      const unknown = dto.entries.filter((e) => !inSection.has(e.studentId));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `${unknown.length} student(s) are not in this section that day`,
        );
      }
      if (new Set(dto.entries.map((e) => e.studentId)).size !== dto.entries.length) {
        throw new BadRequestException('A student appears twice');
      }

      const { records: current, byStudent: currentByStudent } = await this.recordsOfDay(
        db,
        ctx,
        students,
      );
      if (current.length === 0 && dto.entries.length !== students.length) {
        throw new BadRequestException(
          `Mark every student of the section (${students.length - dto.entries.length} missing)`,
        );
      }

      const isToday = dto.date === ctx.today;
      // A record from the section the student moved from goes along with them (a new version
      // here); that alone is no correction. A different status or remark is.
      const movedHere = (r: { classId: string }) => r.classId !== dto.classId;
      const differs = (r: { status: AttendanceStatus; remark: string | null }, e: Entry) =>
        r.status !== e.status || (r.remark ?? '') !== (e.remark ?? '');
      const changes = dto.entries.filter((e) => {
        const r = currentByStudent.get(e.studentId);
        return r && (movedHere(r) || differs(r, e));
      });
      const corrections = changes.filter((e) => differs(currentByStudent.get(e.studentId)!, e));
      const additions = dto.entries.filter((e) => !currentByStudent.has(e.studentId));

      if (corrections.length > 0 && !isToday) {
        assertCan(actor, 'attendance.record.correct', ctx.place);
        if (!dto.reason?.trim()) {
          throw new BadRequestException("Give a reason for changing a past day's attendance");
        }
      }

      const base = {
        organizationId,
        branchId: ctx.place.branchId,
        classId: ctx.section.id,
        academicYearId: ctx.year!.id,
        date: ctx.date,
        period: 0,
        markedBy: actor.id,
        markedByName: actor.name,
      };
      if (additions.length > 0) {
        await db.attendanceRecord.createMany({
          data: additions.map((e) => ({
            ...base,
            studentId: e.studentId,
            status: e.status,
            remark: e.remark,
          })),
        });
      }
      for (const e of changes) {
        const old = currentByStudent.get(e.studentId)!;
        await db.attendanceRecord.update({ where: { id: old.id }, data: { isCurrent: false } });
        await db.attendanceRecord.create({
          data: {
            ...base,
            studentId: e.studentId,
            status: e.status,
            remark: e.remark,
            correctedFromId: old.id,
            correctionReason: movedHere(old)
              ? dto.reason?.trim() || `Moved here from ${ctx.tree.label(old.classId)}`
              : isToday
                ? (dto.reason ?? 'Changed the same day')
                : dto.reason,
          },
        });
      }

      if (additions.length + changes.length > 0) {
        await this.audit.log(db, actor, {
          action: corrections.length > 0 && !isToday ? 'correct attendance' : 'mark attendance',
          entity: 'attendance',
          entityId: ctx.section.id,
          ...ctx.place,
          details: {
            section: ctx.label,
            date: dto.date,
            marked: additions.length,
            changed: changes.length,
            reason: dto.reason,
          },
        });
      }
      return { marked: additions.length, changed: changes.length };
    });
  }

  // --- A branch's day at a glance --------------------------------------------------------------

  dailySummary(organizationId: string, query: DailySummaryQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const branch = await findBranch(db, organizationId, query.branchId);
      const place = { branchId: branch.id };
      if (
        !can(actor, 'attendance.record.view', place) &&
        !can(actor, 'attendance.record.mark', place)
      ) {
        throw new NotFoundException('Branch not found');
      }
      const organization = await findOrganization(db, organizationId);
      const date = this.day(query.date);
      const working = await workingDay(db, organization, branch.id, date);
      const year = await this.yearOn(db, organizationId, date);
      const tree = await ClassTree.load(db, organizationId);
      const sections = tree.classes.filter((c) => c.branchId === branch.id && c.isActive);
      const [enrolled, records] = await Promise.all([
        year
          ? db.enrolment.groupBy({
              by: ['classId'],
              where: { academicYearId: year.id, branchId: branch.id, ...coversDay(date) },
              _count: { _all: true },
            })
          : [],
        db.attendanceRecord.groupBy({
          by: ['classId', 'status'],
          where: { branchId: branch.id, date, period: 0, isCurrent: true },
          _count: { _all: true },
        }),
      ]);
      const rows = sections
        .map((section) => {
          const counts = emptyCounts();
          for (const r of records.filter((r) => r.classId === section.id))
            counts[r.status] = r._count._all;
          const markedCount = Object.values(counts).reduce((a, b) => a + b, 0);
          return {
            section: { id: section.id, name: tree.label(section.id) },
            students: enrolled.find((e) => e.classId === section.id)?._count._all ?? 0,
            marked: markedCount > 0,
            counts,
          };
        })
        .sort((a, b) => a.section.name.localeCompare(b.section.name));
      return {
        date: query.date,
        today: todayIn(organization.timeZone),
        branch: { id: branch.id, name: branch.name },
        academicYear: year ? { id: year.id, name: year.name } : null,
        workingDay: working.working,
        reason: working.reason ?? null,
        sections: rows.filter((r) => r.students > 0 || r.marked),
      };
    });
  }

  // --- Reports ---------------------------------------------------------------------------------

  /** Each student of a section over a date range: counts and percentage. */
  sectionReport(organizationId: string, query: SectionReportQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const section = await this.findSection(db, organizationId, query.classId);
      const place = { branchId: section.branchId! };
      assertCan(actor, 'attendance.report.view', place);
      const { from, to } = this.range(query);
      const organization = await findOrganization(db, organizationId);
      const today = this.day(todayIn(organization.timeZone));
      const until = to < today ? to : today;

      const records = await db.attendanceRecord.findMany({
        where: { classId: section.id, date: { gte: from, lte: to }, period: 0, isCurrent: true },
        select: { studentId: true, status: true, date: true },
      });
      const studentIds = [...new Set(records.map((r) => r.studentId))];
      const students = await db.student.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          fullName: true,
          admissionNo: true,
          enrolments: {
            where: { classId: section.id },
            orderBy: { enrolledOn: 'desc' },
            select: { rollNo: true },
            take: 1,
          },
        },
      });
      const rows = students
        .map((s) => {
          const counts = emptyCounts();
          for (const r of records.filter((r) => r.studentId === s.id)) counts[r.status]++;
          return {
            studentId: s.id,
            fullName: s.fullName,
            admissionNo: s.admissionNo,
            rollNo: s.enrolments[0]?.rollNo ?? null,
            counts,
            percentage: percentage(counts),
          };
        })
        .sort(
          (a, b) =>
            (a.rollNo ?? '').localeCompare(b.rollNo ?? '', undefined, { numeric: true }) ||
            a.fullName.localeCompare(b.fullName),
        );

      const markedDays = new Set(records.map((r) => isoDay(r.date))).size;
      const workingDays =
        from <= until
          ? await countWorkingDays(db, organization, section.branchId!, from, until)
          : 0;
      const tree = await ClassTree.load(db, organizationId);
      return {
        section: { id: section.id, name: tree.label(section.id) },
        from: query.from,
        to: query.to,
        workingDays,
        markedDays,
        unmarkedDays: Math.max(0, workingDays - markedDays),
        students: rows,
      };
    });
  }

  /** One student's attendance over a date range: summary and day by day. */
  studentReport(organizationId: string, studentId: string, query: RangeQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await db.student.findFirst({ where: { id: studentId, organizationId } });
      if (!student) throw new NotFoundException('Student not found');
      const place = { branchId: student.branchId };
      if (!can(actor, 'attendance.record.view', place))
        throw new NotFoundException('Student not found');
      const { from, to } = this.range(query);
      const records = await db.attendanceRecord.findMany({
        where: { studentId, date: { gte: from, lte: to }, period: 0, isCurrent: true },
        orderBy: { date: 'desc' },
        select: {
          date: true,
          status: true,
          remark: true,
          correctedFromId: true,
          correctionReason: true,
        },
      });
      const counts = emptyCounts();
      for (const r of records) counts[r.status]++;
      return {
        from: query.from,
        to: query.to,
        counts,
        percentage: percentage(counts),
        days: records.map((r) => ({
          date: isoDay(r.date),
          status: r.status,
          remark: r.remark,
          corrected: r.correctedFromId !== null,
          correctionReason: r.correctionReason,
        })),
      };
    });
  }

  // --- Settings ----------------------------------------------------------------------------------

  /** The organization's time zone and correction window ("attendance.policy.update" everywhere). */
  updateSettings(organizationId: string, dto: AttendanceSettingsDto, actor: CurrentUser) {
    assertCan(actor, 'attendance.policy.update', {});
    if (dto.timeZone && !isTimeZone(dto.timeZone)) {
      throw new BadRequestException(`Unknown time zone "${dto.timeZone}" (e.g. Asia/Kolkata)`);
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      const before = await findOrganization(db, organizationId);
      const after = await db.organization.update({
        where: { id: organizationId },
        data: { timeZone: dto.timeZone, attendanceCorrectionDays: dto.correctionDays },
        select: { id: true, timeZone: true, attendanceCorrectionDays: true },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'attendance_settings',
        entityId: organizationId,
        details: {
          before: { timeZone: before.timeZone, correctionDays: before.attendanceCorrectionDays },
          after: { timeZone: after.timeZone, correctionDays: after.attendanceCorrectionDays },
        },
      });
      return after;
    });
  }

  // --- Helpers -----------------------------------------------------------------------------------

  /** Everything needed to mark one section on one day. */
  private async context(db: Db, organizationId: string, classId: string, day: string) {
    const section = await this.findSection(db, organizationId, classId);
    const organization = await findOrganization(db, organizationId);
    const date = this.day(day);
    const [working, year, tree] = await Promise.all([
      workingDay(db, organization, section.branchId!, date),
      this.yearOn(db, organizationId, date),
      ClassTree.load(db, organizationId),
    ]);
    return {
      section,
      label: tree.label(section.id),
      tree,
      organization,
      date,
      day,
      today: todayIn(organization.timeZone),
      working,
      year,
      place: { branchId: section.branchId! },
    };
  }

  private blockedReason(ctx: Awaited<ReturnType<AttendanceService['context']>>): string | null {
    if (ctx.day > ctx.today) return 'Attendance cannot be marked for a future day';
    if (!ctx.working.working) return `Not a working day: ${ctx.working.reason}`;
    if (!ctx.year) return 'No academic year covers this day';
    if (ctx.year.status === 'CLOSED') return `The academic year ${ctx.year.name} is closed`;
    return null;
  }

  /**
   * The current records of a register's day: `records` = those marked in this section (was the
   * day marked here?), `byStudent` = each listed student's record wherever it was marked. A
   * student who moved here that day may already be marked in the section they came from; there
   * is only one current record per student and day.
   */
  private async recordsOfDay(
    db: Db,
    ctx: Awaited<ReturnType<AttendanceService['context']>>,
    students: { studentId: string }[],
  ) {
    const listed = new Set(students.map((s) => s.studentId));
    const found = await db.attendanceRecord.findMany({
      where: {
        date: ctx.date,
        period: 0,
        isCurrent: true,
        OR: [{ classId: ctx.section.id }, { studentId: { in: [...listed] } }],
      },
    });
    return {
      records: found.filter((r) => r.classId === ctx.section.id),
      byStudent: new Map(found.filter((r) => listed.has(r.studentId)).map((r) => [r.studentId, r])),
    };
  }

  /** The students placed in a section on a day (ADR-0030), in roll number order. */
  private async studentsOf(db: Db, classId: string, academicYearId: string, date: Date) {
    const enrolments = await db.enrolment.findMany({
      where: { classId, academicYearId, ...coversDay(date) },
      include: { student: { select: { id: true, fullName: true, admissionNo: true } } },
    });
    return enrolments
      .map((e) => ({
        studentId: e.student.id,
        fullName: e.student.fullName,
        admissionNo: e.student.admissionNo,
        rollNo: e.rollNo,
      }))
      .sort(
        (a, b) =>
          (a.rollNo ?? '~').localeCompare(b.rollNo ?? '~', undefined, { numeric: true }) ||
          a.fullName.localeCompare(b.fullName),
      );
  }

  private async findSection(db: Db, organizationId: string, classId: string) {
    const section = await db.class.findFirst({ where: { id: classId, organizationId } });
    if (!section) throw new NotFoundException('Section not found');
    const organization = await findOrganization(db, organizationId);
    if (section.level !== sectionLevel(organization.type) || !section.branchId) {
      throw new BadRequestException('Attendance is marked per section');
    }
    return section;
  }

  private yearOn(db: Db, organizationId: string, date: Date) {
    return db.academicYear.findFirst({
      where: { organizationId, startsOn: { lte: date }, endsOn: { gte: date } },
    });
  }

  private day(value: string): Date {
    const date = parseDay(value);
    if (!date) throw new BadRequestException(`"${value}" is not a date (YYYY-MM-DD)`);
    return date;
  }

  private range(query: RangeQuery) {
    const from = this.day(query.from);
    const to = this.day(query.to);
    if (from > to) throw new BadRequestException('"from" must be on or before "to"');
    if ((to.getTime() - from.getTime()) / 86_400_000 > 400) {
      throw new BadRequestException('Choose a range of at most about a year');
    }
    return { from, to };
  }
}

/** Placements that cover a day: started on or before it, and not ended before it. */
function coversDay(date: Date) {
  return {
    enrolledOn: { lte: date },
    OR: [{ endedOn: null }, { endedOn: { gte: date } }],
  };
}
