/**
 * ENROLMENTS: which section a student is in, in each academic year (one per year).
 *
 * Rules:
 *   - enrolling: "students.student.update" at the student's campus; the section and year are
 *     checked in placement.ts;
 *   - moving to another section of the same campus in the same year: "students.enrolment.transfer";
 *     changing only the roll number: "students.student.update";
 *   - a roll number is unique in a section in a year;
 *   - promotion to the next year comes with part 2 of the Students module.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan } from '../../common/scope';
import { PrismaService } from '../../prisma/prisma.service';
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
        throw new BadRequestException('Only an active student can be placed in a section');
      }
      const { year, section } = await checkPlacement(db, place, dto);
      if (await db.enrolment.findFirst({ where: { studentId, academicYearId: year.id } })) {
        throw new ConflictException(
          `The student already has a section in ${year.name}; move them instead`,
        );
      }
      const enrolment = await db.enrolment.create({
        data: {
          organizationId,
          studentId,
          academicYearId: year.id,
          institutionId: student.institutionId,
          campusId: student.campusId,
          classId: section.id,
          rollNo: dto.rollNo,
          enrolledOn: new Date(),
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
      const enrolment = await db.enrolment.findFirst({
        where: { id: enrolmentId, studentId },
        include: { class: true },
      });
      if (!enrolment) throw new NotFoundException('Enrolment not found');

      const moving = dto.classId !== undefined && dto.classId !== enrolment.classId;
      assertCan(actor, moving ? 'students.enrolment.transfer' : 'students.student.update', place);
      if (enrolment.status !== 'ACTIVE') {
        throw new BadRequestException('Only an active enrolment can be changed');
      }
      let sectionName = enrolment.class.name;
      if (moving) {
        const { section } = await checkPlacement(db, place, {
          academicYearId: enrolment.academicYearId,
          classId: dto.classId!,
        });
        sectionName = section.name;
      }
      const updated = await db.enrolment.update({
        where: { id: enrolmentId },
        data: { classId: dto.classId, rollNo: dto.rollNo },
      });
      await this.audit.log(db, actor, {
        action: moving ? 'move section' : 'update enrolment',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { from: enrolment.class.name, to: sectionName, rollNo: dto.rollNo },
      });
      return updated;
    });
  }
}
