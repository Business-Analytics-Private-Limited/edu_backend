/**
 * THE PORTAL, for parents and students: only the students their login is linked to
 * (CurrentUser.studentIds), read-only.
 *
 *   me()            who is logged in and their students (a parent: all their children)
 *   student(id)     one student's profile: name, admission no, campus, section, batch
 *   attendance(id)  one student's attendance over a period (with the Attendance module)
 *
 * Any other student id gives 404, exactly as if it didn't exist.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { percentage } from '../attendance/attendance.service';
import { PortalRangeQuery } from './dto/portal.dto';

/** What a parent or student may see of a student. */
const STUDENT_FIELDS = {
  id: true,
  fullName: true,
  surname: true,
  admissionNo: true,
  dateOfBirth: true,
  status: true,
  institution: { select: { name: true } },
  campus: { select: { name: true } },
  batch: { select: { name: true, stage: true } },
  enrolments: {
    orderBy: { academicYear: { startsOn: 'desc' as const } },
    take: 1,
    select: {
      rollNo: true,
      academicYear: { select: { name: true } },
      class: { select: { name: true, parent: { select: { name: true } } } },
    },
  },
};

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  me(actor: CurrentUser) {
    return this.prisma.forOrganization(actor.organizationId!, async (db) => {
      const students = await db.student.findMany({
        where: { id: { in: actor.studentIds } },
        select: STUDENT_FIELDS,
        orderBy: { fullName: 'asc' },
      });
      return {
        name: actor.name,
        kind: actor.kind,
        attendance: actor.enabledModules.includes('attendance'),
        students,
      };
    });
  }

  student(actor: CurrentUser, studentId: string) {
    this.checkLinked(actor, studentId);
    return this.prisma.forOrganization(actor.organizationId!, async (db) => {
      const student = await db.student.findFirst({
        where: { id: studentId },
        select: {
          ...STUDENT_FIELDS,
          guardians: {
            select: {
              relation: true,
              isPrimary: true,
              guardian: { select: { fullName: true, phone: true } },
            },
          },
        },
      });
      if (!student) throw new NotFoundException('Student not found');
      return student;
    });
  }

  attendance(actor: CurrentUser, studentId: string, query: PortalRangeQuery) {
    this.checkLinked(actor, studentId);
    if (!actor.enabledModules.includes('attendance')) {
      throw new ForbiddenException('Attendance is not switched on for your school');
    }
    return this.prisma.forOrganization(actor.organizationId!, async (db) => {
      const records = await db.attendanceRecord.findMany({
        where: {
          studentId,
          date: { gte: new Date(query.from), lte: new Date(query.to) },
          period: 0,
          isCurrent: true,
        },
        orderBy: { date: 'desc' },
        select: { date: true, status: true, remark: true },
      });
      const counts = { PRESENT: 0, ABSENT: 0, LATE: 0, HALF_DAY: 0, ON_LEAVE: 0 };
      for (const r of records) counts[r.status]++;
      return {
        from: query.from,
        to: query.to,
        counts,
        percentage: percentage(counts),
        days: records.map((r) => ({
          date: r.date.toISOString().slice(0, 10),
          status: r.status,
          remark: r.remark,
        })),
      };
    });
  }

  /** 404 for any student the login isn't linked to. */
  private checkLinked(actor: CurrentUser, studentId: string) {
    if (!actor.studentIds.includes(studentId)) throw new NotFoundException('Student not found');
  }
}
