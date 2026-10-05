/**
 * STUDENTS: admission, the list, the profile, status changes, deleting a mistake.
 *
 * A student belongs to an institution and studies at one of its CAMPUSES; that campus is the
 * student's place (ADR-0018): a Campus admin sees and manages the students of their campus,
 * a Principal those of their institution. Guardians and enrolments are in their own services.
 *
 * Rules:
 *   - the admission number is unique in the institution; left empty, it is the next number of
 *     the institution's pattern (admission-numbers.ts);
 *   - a student can move to another campus of the same institution ("students.enrolment.transfer"
 *     at BOTH campuses); their current section moves with them;
 *   - a batch must belong to the student's institution;
 *   - placing a student needs an academic year of the institution that isn't closed, and a
 *     section (a class of the LAST level) on the student's campus (see placement.ts);
 *   - every status change is kept in the status history with its date and reason; leaving
 *     (transferred, discontinued, alumni) also closes the student's active enrolment.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { paginated, toSkipTake } from '../../common/pagination';
import { assertCan } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { nextAdmissionNo } from './admission-numbers';
import {
  AdmitStudentDto,
  ChangeStatusDto,
  ListStudentsQuery,
  TransferCampusDto,
  UpdateStudentDto,
} from './dto/student.dto';
import { GuardiansService } from './guardians.service';
import {
  checkBatch,
  checkPlacement,
  descendantClassIds,
  findCampus,
  findVisibleStudent,
  placeOf,
  visibleStudentsWhere,
} from './placement';
import { assertCampusInUse } from '../organization/places-in-use';

/** What the list shows of each student. */
const LIST_FIELDS = {
  id: true,
  admissionNo: true,
  fullName: true,
  surname: true,
  gender: true,
  phone: true,
  status: true,
  campus: { select: { id: true, name: true } },
  batch: { select: { id: true, name: true, stage: true } },
  enrolments: {
    orderBy: { academicYear: { startsOn: 'desc' } },
    take: 1,
    select: {
      rollNo: true,
      academicYear: { select: { id: true, name: true } },
      class: { select: { id: true, name: true, parent: { select: { name: true } } } },
    },
  },
} satisfies Prisma.StudentSelect;

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guardians: GuardiansService,
    private readonly files: FilesService,
  ) {}

  list(organizationId: string, query: ListStudentsQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const enrolmentFilter: Prisma.EnrolmentWhereInput = {
        ...(query.academicYearId && { academicYearId: query.academicYearId }),
        ...(query.classId && { classId: { in: await descendantClassIds(db, query.classId) } }),
      };
      const where: Prisma.StudentWhereInput = {
        ...visibleStudentsWhere(organizationId, actor),
        ...(query.campusId && { campusId: query.campusId }),
        ...(query.batchId && { batchId: query.batchId }),
        ...(query.status && { status: query.status }),
        ...((query.classId || query.academicYearId) && { enrolments: { some: enrolmentFilter } }),
        ...(query.search && {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { surname: { contains: query.search, mode: 'insensitive' } },
            { admissionNo: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
          ],
        }),
      };
      const [items, total] = await Promise.all([
        db.student.findMany({
          where,
          select: LIST_FIELDS,
          orderBy: [{ fullName: 'asc' }],
          ...toSkipTake(query),
        }),
        db.student.count({ where }),
      ]);
      return paginated(items, total, query);
    });
  }

  get(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await findVisibleStudent(db, organizationId, id, actor);
      return this.profile(db, id);
    });
  }

  /** Admission: the student, and optionally their first section and guardians, all at once. */
  admit(organizationId: string, dto: AdmitStudentDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const campus = await findCampus(db, organizationId, dto.campusId);
      const place = { institutionId: campus.institutionId, campusId: campus.id };
      assertCan(actor, 'students.student.create', place);
      await assertCampusInUse(db, campus.id);
      if (dto.batchId) await checkBatch(db, campus.institutionId, dto.batchId);
      if (dto.enrolment) await checkPlacement(db, place, dto.enrolment);

      const { enrolment, guardians, campusId, ...profile } = dto;
      const admissionNo =
        dto.admissionNo ??
        (await nextAdmissionNo(
          db,
          await db.institution.findUniqueOrThrow({ where: { id: campus.institutionId } }),
          new Date(dto.admissionDate),
        ));
      const student = await db.student.create({
        data: {
          ...profile,
          admissionNo,
          organizationId,
          institutionId: campus.institutionId,
          campusId,
          admissionDate: new Date(dto.admissionDate),
          dateOfBirth: new Date(dto.dateOfBirth),
          statusChanges: {
            create: {
              organizationId,
              toStatus: 'ACTIVE',
              effectiveOn: new Date(dto.admissionDate),
              reason: 'Admission',
              changedBy: actor.id,
            },
          },
          ...(enrolment && {
            enrolments: {
              create: {
                organizationId,
                institutionId: campus.institutionId,
                campusId,
                academicYearId: enrolment.academicYearId,
                classId: enrolment.classId,
                rollNo: enrolment.rollNo,
                enrolledOn: new Date(dto.admissionDate),
              },
            },
          }),
        },
      });
      for (const guardian of guardians ?? []) {
        await this.guardians.link(db, organizationId, student.id, guardian);
      }
      await this.audit.log(db, actor, {
        action: 'admit',
        entity: 'student',
        entityId: student.id,
        ...place,
        details: { admissionNo: student.admissionNo, fullName: student.fullName },
      });
      return this.profile(db, student.id);
    });
  }

  update(organizationId: string, id: string, dto: UpdateStudentDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await findVisibleStudent(db, organizationId, id, actor);
      const place = placeOf(existing);
      assertCan(actor, 'students.student.update', place);
      if (dto.batchId) await checkBatch(db, existing.institutionId, dto.batchId);
      await db.student.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.dateOfBirth && { dateOfBirth: new Date(dto.dateOfBirth) }),
        },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'student',
        entityId: id,
        ...place,
        details: { ...dto },
      });
      return this.profile(db, id);
    });
  }

  changeStatus(organizationId: string, id: string, dto: ChangeStatusDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await findVisibleStudent(db, organizationId, id, actor);
      const place = placeOf(existing);
      assertCan(actor, 'students.student.update', place);
      if (existing.status === dto.status) {
        throw new BadRequestException(`The student is already ${dto.status.toLowerCase()}`);
      }
      await db.student.update({ where: { id }, data: { status: dto.status } });
      await db.studentStatusChange.create({
        data: {
          organizationId,
          studentId: id,
          fromStatus: existing.status,
          toStatus: dto.status,
          effectiveOn: new Date(dto.effectiveOn),
          reason: dto.reason,
          changedBy: actor.id,
        },
      });
      // Leaving ends the current enrolment (back to ACTIVE doesn't reopen it automatically).
      if (dto.status !== 'ACTIVE') {
        await db.enrolment.updateMany({
          where: { studentId: id, status: 'ACTIVE' },
          data: { status: dto.status === 'ALUMNI' ? 'COMPLETED' : 'LEFT' },
        });
      }
      await this.audit.log(db, actor, {
        action: 'change status',
        entity: 'student',
        entityId: id,
        ...place,
        details: { from: existing.status, to: dto.status, reason: dto.reason },
      });
      return this.profile(db, id);
    });
  }

  /**
   * Moves a student to another campus of the same institution. A current section (in a year
   * that isn't closed) moves to `toSectionId` on the new campus; its roll number is cleared.
   */
  transferCampus(organizationId: string, id: string, dto: TransferCampusDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, id, actor);
      const from = placeOf(student);
      const toCampus = await findCampus(db, organizationId, dto.toCampusId);
      await assertCampusInUse(db, toCampus.id);
      const to = { institutionId: toCampus.institutionId, campusId: toCampus.id };
      if (toCampus.institutionId !== student.institutionId) {
        throw new BadRequestException(
          'A student can only move to a campus of the same institution; for another institution, admit them there',
        );
      }
      if (toCampus.id === student.campusId) {
        throw new BadRequestException('The student is already at this campus');
      }
      assertCan(actor, 'students.enrolment.transfer', from);
      assertCan(actor, 'students.enrolment.transfer', to);

      const current = await db.enrolment.findFirst({
        where: { studentId: id, status: 'ACTIVE', academicYear: { status: { not: 'CLOSED' } } },
      });
      if (current) {
        if (!dto.toSectionId) {
          throw new BadRequestException(
            'The student has a current section: choose their section on the new campus',
          );
        }
        await checkPlacement(db, to, {
          academicYearId: current.academicYearId,
          classId: dto.toSectionId,
        });
        await db.enrolment.update({
          where: { id: current.id },
          data: { campusId: toCampus.id, classId: dto.toSectionId, rollNo: null },
        });
      }
      await db.student.update({ where: { id }, data: { campusId: toCampus.id } });
      // Logged at both campuses, so both campus admins see it.
      for (const place of [from, to]) {
        await this.audit.log(db, actor, {
          action: 'transfer campus',
          entity: 'student',
          entityId: id,
          ...place,
          details: { from: from.campusId, to: to.campusId, reason: dto.reason },
        });
      }
      return this.profile(db, id);
    });
  }

  /** For mistakes only (normal exits use a status). Removes enrolments, links and history too. */
  async delete(organizationId: string, id: string, actor: CurrentUser) {
    const storageKeys = await this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await findVisibleStudent(db, organizationId, id, actor);
      const place = placeOf(existing);
      assertCan(actor, 'students.student.delete', place);
      const files = (
        await db.studentDocument.findMany({ where: { studentId: id }, select: { file: true } })
      ).map((d) => d.file);
      const guardianIds = (
        await db.studentGuardian.findMany({
          where: { studentId: id },
          select: { guardianId: true },
        })
      ).map((g) => g.guardianId);
      await db.student.delete({ where: { id } }); // documents go with the student
      await db.storedFile.deleteMany({ where: { id: { in: files.map((f) => f.id) } } });
      // Guardians who no longer belong to any student go too.
      await db.guardian.deleteMany({ where: { id: { in: guardianIds }, students: { none: {} } } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'student',
        entityId: id,
        ...place,
        details: { admissionNo: existing.admissionNo, fullName: existing.fullName },
      });
      return files.map((f) => f.storageKey);
    });
    // The documents' files on disk, once the database change is saved.
    await this.files.removeLater(storageKeys);
    return { deleted: true };
  }

  /** The full profile: details, campus, batch, guardians, enrolments, status history. */
  private profile(db: Db, id: string) {
    return db.student.findUniqueOrThrow({
      where: { id },
      include: {
        institution: { select: { id: true, name: true } },
        campus: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true, stage: true } },
        guardians: {
          include: {
            guardian: {
              include: { login: { select: { id: true, email: true, status: true } } },
            },
          },
          orderBy: { isPrimary: 'desc' },
        },
        // The student's own portal login, if any.
        login: { select: { id: true, email: true, status: true } },
        enrolments: {
          orderBy: { academicYear: { startsOn: 'desc' } },
          include: {
            academicYear: { select: { id: true, name: true, status: true } },
            class: { select: { id: true, name: true, parent: { select: { name: true } } } },
          },
        },
        statusChanges: { orderBy: { changedAt: 'desc' } },
      },
    });
  }
}
