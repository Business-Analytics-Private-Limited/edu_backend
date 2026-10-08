/**
 * ENROLMENTS (placements, ADR-0030): which section a student is in, from which day.
 *
 *   enrol    places a current student who has no current section (e.g. not placed at
 *            admission, or re-admitted) in a section of their branch for a year;
 *   update   changes only the roll number of a placement.
 * Section and branch changes are in students.service.ts (they keep the history); promotion to
 * the next year is in promotions.service.ts.
 *
 * Rules: "students.student.update" at the student's branch; a roll number is unique in a
 * section in a year.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EnrolmentDto, UpdateEnrolmentDto } from './dto/student.dto';
import { checkPlacement, findVisibleStudent, placeOf } from './placement';

@Injectable()
export class EnrolmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  enrol(organizationId: string, studentId: string, dto: EnrolmentDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.student.update', place);
      if (student.status !== 'ACTIVE') {
        throw new BadRequestException('Only a current student can be placed in a section');
      }
      if (await db.enrolment.findFirst({ where: { studentId, status: 'ACTIVE' } })) {
        throw new ConflictException(
          'The student already has a current section; change their section instead',
        );
      }
      const { year, section } = await checkPlacement(db, organizationId, student.branchId, dto);
      await this.checkRollFree(db, year.id, section.id, dto.rollNo);
      // From today, but never before the year starts.
      const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const enrolment = await db.enrolment.create({
        data: {
          organizationId,
          studentId,
          academicYearId: year.id,
          branchId: student.branchId,
          classId: section.id,
          rollNo: dto.rollNo,
          enrolledOn: today < year.startsOn ? year.startsOn : today,
        },
      });
      await this.audit.log(db, actor, {
        action: 'enrol',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { year: year.name, section: section.name, rollNo: dto.rollNo },
      });
      return enrolment;
    });
  }

  update(
    organizationId: string,
    studentId: string,
    enrolmentId: string,
    dto: UpdateEnrolmentDto,
    actor: CurrentUser,
  ) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.student.update', place);
      const enrolment = await db.enrolment.findFirst({ where: { id: enrolmentId, studentId } });
      if (!enrolment) throw new NotFoundException('Enrolment not found');
      if (enrolment.status !== 'ACTIVE') {
        throw new BadRequestException('Only the current placement can be changed');
      }
      await this.checkRollFree(
        db,
        enrolment.academicYearId,
        enrolment.classId,
        dto.rollNo,
        enrolment.id,
      );
      const updated = await db.enrolment.update({
        where: { id: enrolmentId },
        data: { rollNo: dto.rollNo },
      });
      await this.audit.log(db, actor, {
        action: 'update roll number',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { from: enrolment.rollNo, to: dto.rollNo },
      });
      return updated;
    });
  }

  private async checkRollFree(
    db: Db,
    academicYearId: string,
    classId: string,
    rollNo: string | null | undefined,
    exceptId?: string,
  ) {
    if (!rollNo) return;
    const taken = await db.enrolment.findFirst({
      where: {
        academicYearId,
        classId,
        rollNo,
        status: 'ACTIVE',
        ...(exceptId && { id: { not: exceptId } }),
      },
    });
    if (taken) throw new ConflictException(`Roll number ${rollNo} is already used in that section`);
  }
}
