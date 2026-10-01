/**
 * ATTENDANCE: marking a section's register for a day, changes and corrections, the daily
 * overview of a campus, and reports.
 *
 * Rules (ADR-0021):
 *   - attendance is marked per SECTION (a class of the last level) and DAY, at the section's
 *     campus ("attendance.record.mark");
 *   - only on a working day (not a weekly off day, not a holiday), never in the future, inside
 *     an academic year that isn't closed, and not further back than the institution's correction
 *     window (default 7 days);
 *   - the first marking of a day covers every student of the section;
 *   - records are never overwritten: a change makes a new version pointing to the old one.
 *     Changing TODAY's attendance needs "mark"; changing a past day is a correction: it needs
 *     "attendance.record.correct" and a reason;
 *   - "today" is the date in the institution's time zone.
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

type Counts = Record<AttendanceStatus, number>;
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
      const records = await db.attendanceRecord.findMany({
        where: { classId, date: ctx.date, period: 0, isCurrent: true },
      });
      const byStudent = new Map(records.map((r) => [r.studentId, r]));
      const lastMarked = records.reduce<(typeof records)[number] | null>(
        (latest, r) => (!latest || r.createdAt > latest.createdAt ? r : latest),
        null,
      );
      return {
        date: day,
        today: ctx.today,
        section: { id: ctx.section.id, name: ctx.section.name, campusId: ctx.section.campusId },
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
      const blocked = this.blockedReason(ctx);
      if (blocked) throw new BadRequestException(blocked);
      const beyondWindow =
        dto.date < daysBefore(ctx.today, ctx.institution.attendanceCorrectionDays);
      if (beyondWindow && !can(actor, 'attendance.policy.update', ctx.place)) {
        throw new BadRequestException(
          `Days more than ${ctx.institution.attendanceCorrectionDays} day(s) back can no longer be marked or changed`,
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

      const current = await db.attendanceRecord.findMany({
        where: { classId: dto.classId, date: ctx.date, period: 0, isCurrent: true },
      });
      const currentByStudent = new Map(current.map((r) => [r.studentId, r]));
      if (current.length === 0 && dto.entries.length !== students.length) {
        throw new BadRequestException(
          `Mark every student of the section (${students.length - dto.entries.length} missing)`,
        );
      }

      const isToday = dto.date === ctx.today;
      const changes = dto.entries.filter((e) => {
        const r = currentByStudent.get(e.studentId);
        return r && (r.status !== e.status || (r.remark ?? '') !== (e.remark ?? ''));
      });
      const additions = dto.entries.filter((e) => !currentByStudent.has(e.studentId));

      if (changes.length > 0 && !isToday) {
        assertCan(actor, 'attendance.record.correct', ctx.place);
        if (!dto.reason?.trim()) {
          throw new BadRequestException("Give a reason for changing a past day's attendance");
        }
      }

      const base = {
        organizationId,
        institutionId: ctx.section.institutionId,
        campusId: ctx.section.campusId,
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
            correctionReason: isToday ? (dto.reason ?? 'Changed the same day') : dto.reason,
          },
        });
      }

      if (additions.length + changes.length > 0) {
        await this.audit.log(db, actor, {
          action: changes.length > 0 && !isToday ? 'correct attendance' : 'mark attendance',
          entity: 'attendance',
          entityId: ctx.section.id,
          ...ctx.place,
          details: {
            section: ctx.section.name,
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

  // --- A campus's day at a glance --------------------------------------------------------------

  dailySummary(organizationId: string, query: DailySummaryQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const campus = await db.campus.findFirst({
        where: { id: query.campusId, organizationId },
        include: { institution: true },
      });
      if (!campus) throw new NotFoundException('Campus not found');
      const place = { institutionId: campus.institutionId, campusId: campus.id };
      if (
        !can(actor, 'attendance.record.view', place) &&
        !can(actor, 'attendance.record.mark', place)
      ) {
        throw new NotFoundException('Campus not found');
      }
      const date = this.day(query.date);
      const working = await workingDay(db, campus.institution, campus.id, date);
      const year = await this.yearOn(db, campus.institutionId, date);
      const levels = await db.classLevel.count({ where: { institutionId: campus.institutionId } });
      const sections = await db.class.findMany({
        where: { campusId: campus.id, level: levels, isActive: true },
        include: { parent: { select: { name: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      const [enrolled, records] = await Promise.all([
        year
          ? db.enrolment.groupBy({
              by: ['classId'],
              where: { academicYearId: year.id, campusId: campus.id, status: 'ACTIVE' },
              _count: { _all: true },
            })
          : [],
        db.attendanceRecord.groupBy({
          by: ['classId', 'status'],
          where: { campusId: campus.id, date, period: 0, isCurrent: true },
          _count: { _all: true },
        }),
      ]);
      const rows = sections.map((section) => {
        const counts = emptyCounts();
        for (const r of records.filter((r) => r.classId === section.id))
          counts[r.status] = r._count._all;
        const markedCount = Object.values(counts).reduce((a, b) => a + b, 0);
        return {
          section: {
            id: section.id,
            name: section.parent ? `${section.parent.name} › ${section.name}` : section.name,
          },
          students: enrolled.find((e) => e.classId === section.id)?._count._all ?? 0,
          marked: markedCount > 0,
          counts,
        };
      });
      return {
        date: query.date,
        today: todayIn(campus.institution.timeZone),
        campus: { id: campus.id, name: campus.name },
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
      const place = { institutionId: section.institutionId, campusId: section.campusId };
      assertCan(actor, 'attendance.report.view', place);
      const { from, to } = this.range(query);
      const institution = await db.institution.findUniqueOrThrow({
        where: { id: section.institutionId },
      });
      const today = this.day(todayIn(institution.timeZone));
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
          enrolments: { where: { classId: section.id }, select: { rollNo: true }, take: 1 },
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
        from <= until ? await countWorkingDays(db, institution, section.campusId, from, until) : 0;
      return {
        section: { id: section.id, name: section.name },
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
      const place = { institutionId: student.institutionId, campusId: student.campusId };
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

  updateSettings(
    organizationId: string,
    institutionId: string,
    dto: AttendanceSettingsDto,
    actor: CurrentUser,
  ) {
    const place = { institutionId };
    assertCan(actor, 'attendance.policy.update', place);
    if (dto.timeZone && !isTimeZone(dto.timeZone)) {
      throw new BadRequestException(`Unknown time zone "${dto.timeZone}" (e.g. Asia/Kolkata)`);
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      const before = await db.institution.findFirst({
        where: { id: institutionId, organizationId },
      });
      if (!before) throw new NotFoundException('Institution not found');
      const after = await db.institution.update({
        where: { id: institutionId },
        data: { timeZone: dto.timeZone, attendanceCorrectionDays: dto.correctionDays },
        select: { id: true, timeZone: true, attendanceCorrectionDays: true },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'attendance_settings',
        entityId: institutionId,
        ...place,
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
    const institution = await db.institution.findUniqueOrThrow({
      where: { id: section.institutionId },
    });
    const date = this.day(day);
    const [working, year] = await Promise.all([
      workingDay(db, institution, section.campusId, date),
      this.yearOn(db, institution.id, date),
    ]);
    return {
      section,
      institution,
      date,
      day,
      today: todayIn(institution.timeZone),
      working,
      year,
      place: { institutionId: section.institutionId, campusId: section.campusId },
    };
  }

  private blockedReason(ctx: Awaited<ReturnType<AttendanceService['context']>>): string | null {
    if (ctx.day > ctx.today) return 'Attendance cannot be marked for a future day';
    if (!ctx.working.working) return `Not a working day: ${ctx.working.reason}`;
    if (!ctx.year) return 'No academic year of the institution covers this day';
    if (ctx.year.status === 'CLOSED') return `The academic year ${ctx.year.name} is closed`;
    return null;
  }

  /** The students of a section in a year (not those who left), in roll number order. */
  private async studentsOf(db: Db, classId: string, academicYearId: string, date: Date) {
    const enrolments = await db.enrolment.findMany({
      where: {
        classId,
        academicYearId,
        status: { not: 'LEFT' },
        // Not admitted yet that day: not on the register.
        student: { admissionDate: { lte: date } },
      },
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
    const levels = await db.classLevel.count({ where: { institutionId: section.institutionId } });
    if (section.level !== levels) {
      throw new BadRequestException('Attendance is marked per section (a class of the last level)');
    }
    return section;
  }

  private yearOn(db: Db, institutionId: string, date: Date) {
    return db.academicYear.findFirst({
      where: { institutionId, startsOn: { lte: date }, endsOn: { gte: date } },
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
