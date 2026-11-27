/**
 * THE PORTAL, for parents and students: only the students their login is linked to
 * (CurrentUser.studentIds), read-only.
 *
 *   me()            who is logged in and their students (a parent: all their children)
 *   student(id)     one student's profile: name, admission no, branch, current section
 *   attendance(id)  one student's attendance over a period (with the Attendance module)
 *   exams(id), examResult(id, examId), reportCard(id, examId)
 *                   results of LOCKED exams, and the report card PDF (with the Evaluation
 *                   module, ADR-0036). An exam still open is never shown: marks may change.
 *
 * Any other student id gives 404, exactly as if it didn't exist.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { PrismaService } from '../../prisma/prisma.service';
import { ClassTree } from '../academic/class-tree';
import { percentage } from '../attendance/attendance.service';
import { ReportCardsService } from '../evaluation/report-cards.service';
import { PortalRangeQuery } from './dto/portal.dto';

/** What a parent or student may see of a student. */
const STUDENT_FIELDS = {
  id: true,
  fullName: true,
  surname: true,
  admissionNo: true,
  dateOfBirth: true,
  status: true,
  organization: { select: { name: true } },
  branch: { select: { name: true } },
  enrolments: {
    orderBy: [{ enrolledOn: 'desc' as const }, { createdAt: 'desc' as const }],
    take: 1,
    select: { rollNo: true, classId: true, academicYear: { select: { name: true } } },
  },
};

/** The current placement as text ("Junior › MPC › JEE Mains › JEE-A"), instead of class ids. */
function withPlacement<
  T extends {
    enrolments: { classId: string; rollNo: string | null; academicYear: { name: string } }[];
  },
>(tree: ClassTree, student: T) {
  const { enrolments, ...rest } = student;
  const current = enrolments[0];
  return {
    ...rest,
    placement: current
      ? {
          academicYear: current.academicYear.name,
          section: tree.label(current.classId),
          rollNo: current.rollNo,
        }
      : null,
  };
}

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportCards: ReportCardsService,
  ) {}

  me(actor: CurrentUser) {
    return this.prisma.forOrganization(actor.organizationId!, async (db) => {
      const [students, tree] = await Promise.all([
        db.student.findMany({
          where: { id: { in: actor.studentIds } },
          select: STUDENT_FIELDS,
          orderBy: { fullName: 'asc' },
        }),
        ClassTree.load(db, actor.organizationId!),
      ]);
      return {
        name: actor.name,
        kind: actor.kind,
        attendance: actor.enabledModules.includes('attendance'),
        results: actor.enabledModules.includes('evaluation'),
        students: students.map((s) => withPlacement(tree, s)),
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
      return withPlacement(await ClassTree.load(db, actor.organizationId!), student);
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

  exams(actor: CurrentUser, studentId: string) {
    this.checkResults(actor, studentId);
    return this.reportCards.portalExams(actor.organizationId!, studentId);
  }

  examResult(actor: CurrentUser, studentId: string, examId: string) {
    this.checkResults(actor, studentId);
    return this.reportCards.portalResult(actor.organizationId!, examId, studentId);
  }

  reportCard(actor: CurrentUser, studentId: string, examId: string) {
    this.checkResults(actor, studentId);
    return this.reportCards.forPortal(actor.organizationId!, examId, studentId);
  }

  private checkResults(actor: CurrentUser, studentId: string) {
    this.checkLinked(actor, studentId);
    if (!actor.enabledModules.includes('evaluation')) {
      throw new ForbiddenException('Results are not switched on for your school');
    }
  }

  /** 404 for any student the login isn't linked to. */
  private checkLinked(actor: CurrentUser, studentId: string) {
    if (!actor.studentIds.includes(studentId)) throw new NotFoundException('Student not found');
  }
}
