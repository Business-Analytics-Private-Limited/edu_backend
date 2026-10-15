/**
 * STUDENTS: admission, the list, the profile, leaving and re-admission, section and branch
 * changes, deleting a mistake (ADR-0020, ADR-0030).
 *
 * A student studies at one BRANCH; that branch is the student's place: a Branch admin sees and
 * manages the students of their branch, organization-wide roles (Director ...) see everyone.
 * Guardians and placing a student in a year are in their own services.
 *
 * Rules:
 *   - admission numbers: AUTOMATIC from the organization's pattern, or MANUAL (typed); unique in
 *     the organization (admission-numbers.ts);
 *   - CURRENT students are ACTIVE; OUTGOING students (TRANSFERRED, DISCONTINUED, COMPLETED) are
 *     kept in full but hidden from current lists, registers and promotion, and lose their portal
 *     login. They can be re-admitted;
 *   - a placement (enrolment) is never overwritten: a section or branch change ends it the day
 *     before the change and starts a new one, so the timeline and attendance stay right;
 *   - section and branch changes are made for one student, from the profile
 *     ("students.enrolment.transfer"; for a branch change at BOTH branches);
 *   - every detail follows the rules in student-rules.ts (also used by the import); Aadhaar is
 *     unique in the organization;
 *   - SENSITIVE details (Aadhaar, category, sub-caste, medical condition) are only shown with
 *     "students.sensitive.view"; others see the Aadhaar masked and the rest empty (ADR-0031).
 */
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { paginated, toSkipTake } from '../../common/pagination';
import { assertCan, can } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { ClassTree } from '../academic/class-tree';
import { AuditService } from '../audit/audit.service';
import { FilesService } from '../files/files.service';
import { assertBranchInUse, findBranch, findOrganization } from '../organization/places-in-use';
import { admissionNumberFor } from './admission-numbers';
import {
  AdmitStudentDto,
  ChangeBranchDto,
  ChangeSectionDto,
  LeaveDto,
  ListStudentsQuery,
  ReadmitDto,
  SENSITIVE_FIELDS,
  UpdateStudentDto,
} from './dto/student.dto';
import { GuardiansService } from './guardians.service';
import {
  assertRollFree,
  checkPlacement,
  closePortalLogins,
  dayBefore,
  effectiveDay,
  findVisibleStudent,
  placeOf,
  visibleStudentsWhere,
} from './placement';
import { checkStudentRules, maskAadhaar } from './student-rules';

/** What the list shows of each student (the placement label is added from the class tree). */
const LIST_FIELDS = {
  id: true,
  admissionNo: true,
  fullName: true,
  surname: true,
  gender: true,
  phone: true,
  status: true,
  topRanker: true,
  learnerLevel: true,
  branch: { select: { id: true, name: true } },
  enrolments: {
    orderBy: [{ enrolledOn: 'desc' }, { createdAt: 'desc' }],
    take: 1,
    select: {
      classId: true,
      rollNo: true,
      status: true,
      academicYear: { select: { id: true, name: true } },
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

  /**
   * Current students (default), outgoing ones, or all; filtered by branch, by any class of the
   * structure (a year, group, stream ... in every branch, or one section), and by year.
   */
  list(organizationId: string, query: ListStudentsQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const tree = await ClassTree.load(db, organizationId);
      const show = query.show ?? 'current';
      const statusFilter: Prisma.StudentWhereInput = query.status
        ? { status: query.status }
        : show === 'current'
          ? { status: 'ACTIVE' }
          : show === 'outgoing'
            ? { status: { not: 'ACTIVE' } }
            : {};
      const placement: Prisma.EnrolmentWhereInput | null =
        query.classId || query.academicYearId
          ? {
              ...(query.classId && { classId: { in: tree.below(query.classId) } }),
              ...(query.academicYearId && { academicYearId: query.academicYearId }),
              // Current students: where they are NOW; outgoing: where they ever were.
              ...(show === 'current' && !query.status && { status: 'ACTIVE' }),
            }
          : null;
      const where: Prisma.StudentWhereInput = {
        ...visibleStudentsWhere(organizationId, actor),
        ...statusFilter,
        ...(query.branchId && { branchId: query.branchId }),
        ...(query.topRanker && { topRanker: query.topRanker === 'true' }),
        ...(query.learnerLevel && { learnerLevel: query.learnerLevel }),
        ...(placement && { enrolments: { some: placement } }),
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
      return paginated(
        items.map(({ enrolments, ...student }) => ({
          ...student,
          placement: enrolments[0]
            ? {
                academicYear: enrolments[0].academicYear,
                section: tree.label(enrolments[0].classId),
                rollNo: enrolments[0].rollNo,
                status: enrolments[0].status,
              }
            : null,
        })),
        total,
        query,
      );
    });
  }

  get(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await findVisibleStudent(db, organizationId, id, actor);
      return this.profile(db, organizationId, id, actor);
    });
  }

  /** Admission: the student, and optionally their first section and guardians, all at once. */
  admit(organizationId: string, dto: AdmitStudentDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const branch = await findBranch(db, organizationId, dto.branchId);
      const place = { branchId: branch.id };
      assertCan(actor, 'students.student.create', place);
      await assertBranchInUse(db, branch.id);
      if (dto.enrolment) {
        await checkPlacement(db, organizationId, branch.id, dto.enrolment);
        await assertRollFree(
          db,
          dto.enrolment.academicYearId,
          dto.enrolment.classId,
          dto.enrolment.rollNo,
        );
      }
      const problems = checkStudentRules(dto);
      if (problems.length) throw new BadRequestException(problems);
      if (dto.aadhaar) await this.checkAadhaarFree(db, organizationId, dto.aadhaar);

      // With AUTOMATIC numbering, a typed number is ignored.
      const { enrolment, guardians, branchId, admissionNo: typed, ...profile } = dto;
      const organization = await findOrganization(db, organizationId);
      const admissionDate = new Date(dto.admissionDate);
      const admissionNo = await admissionNumberFor(
        db,
        { ...organization, organizationId },
        branch,
        admissionDate,
        typed,
      );
      await this.checkAdmissionNoFree(db, organizationId, admissionNo);

      const student = await db.student.create({
        data: {
          ...profile,
          admissionNo,
          organizationId,
          branchId,
          admissionDate,
          dateOfBirth: new Date(dto.dateOfBirth),
          statusChanges: {
            create: {
              organizationId,
              toStatus: 'ACTIVE',
              effectiveOn: admissionDate,
              reason: 'Admission',
              changedBy: actor.id,
            },
          },
          ...(enrolment && {
            enrolments: {
              create: {
                organizationId,
                branchId,
                academicYearId: enrolment.academicYearId,
                classId: enrolment.classId,
                rollNo: enrolment.rollNo,
                enrolledOn: admissionDate,
                reason: 'Admission',
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
      return this.profile(db, organizationId, student.id, actor);
    });
  }

  update(organizationId: string, id: string, dto: UpdateStudentDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await findVisibleStudent(db, organizationId, id, actor);
      const place = placeOf(existing);
      assertCan(actor, 'students.student.update', place);
      if (dto.admissionNo && dto.admissionNo !== existing.admissionNo) {
        await this.checkAdmissionNoFree(db, organizationId, dto.admissionNo);
      }
      // The rules across fields, on the student as it will be after the change.
      const problems = checkStudentRules({
        dateOfBirth: dto.dateOfBirth ?? existing.dateOfBirth,
        admissionDate: existing.admissionDate,
        busFacility: dto.busFacility ?? existing.busFacility,
        pickupPoint: dto.pickupPoint !== undefined ? dto.pickupPoint : existing.pickupPoint,
      });
      if (problems.length) throw new BadRequestException(problems);
      if (dto.aadhaar && dto.aadhaar !== existing.aadhaar) {
        await this.checkAadhaarFree(db, organizationId, dto.aadhaar);
      }
      await db.student.update({
        where: { id },
        data: {
          ...dto,
          ...(dto.dateOfBirth && { dateOfBirth: new Date(dto.dateOfBirth) }),
        },
      });
      // Sensitive values never go into the audit log: only that they changed.
      const details: Record<string, Prisma.InputJsonValue | null> = { ...dto };
      for (const field of SENSITIVE_FIELDS) {
        if (field in details) details[field] = '(changed)';
      }
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'student',
        entityId: id,
        ...place,
        details,
      });
      return this.profile(db, organizationId, id, actor);
    });
  }

  /**
   * The student leaves (transferred, discontinued, or completed): they become OUTGOING. Their
   * current placement ends on that day, and their portal login (and a parent's, if that parent
   * has no other current child) stops working.
   */
  leave(organizationId: string, id: string, dto: LeaveDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await findVisibleStudent(db, organizationId, id, actor);
      const place = placeOf(existing);
      assertCan(actor, 'students.student.update', place);
      if (existing.status !== 'ACTIVE') {
        throw new BadRequestException('The student has already left');
      }
      const day = effectiveDay(dto.effectiveOn, existing.admissionDate);
      const current = await db.enrolment.findFirst({ where: { studentId: id, status: 'ACTIVE' } });
      if (current) {
        if (day < current.enrolledOn) {
          throw new BadRequestException(
            `The student is in their section since ${isoDay(current.enrolledOn)}; choose that day or later`,
          );
        }
        await db.enrolment.update({
          where: { id: current.id },
          data: { status: dto.status === 'COMPLETED' ? 'COMPLETED' : 'LEFT', endedOn: day },
        });
      }
      await db.student.update({ where: { id }, data: { status: dto.status } });
      await db.studentStatusChange.create({
        data: {
          organizationId,
          studentId: id,
          fromStatus: existing.status,
          toStatus: dto.status,
          effectiveOn: day,
          reason: dto.reason,
          destination: dto.destination,
          changedBy: actor.id,
        },
      });
      const logins = await closePortalLogins(db, id);
      await this.audit.log(db, actor, {
        action: 'leave',
        entity: 'student',
        entityId: id,
        ...place,
        details: {
          status: dto.status,
          effectiveOn: dto.effectiveOn,
          reason: dto.reason,
          destination: dto.destination,
          portalLoginsClosed: logins,
        },
      });
      return this.profile(db, organizationId, id, actor);
    });
  }

  /** An outgoing student comes back: current again. Place them in a section afterwards. */
  readmit(organizationId: string, id: string, dto: ReadmitDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await findVisibleStudent(db, organizationId, id, actor);
      const place = placeOf(existing);
      assertCan(actor, 'students.student.update', place);
      await assertBranchInUse(db, existing.branchId);
      if (existing.status === 'ACTIVE') {
        throw new BadRequestException('The student is already a current student');
      }
      await db.student.update({ where: { id }, data: { status: 'ACTIVE' } });
      await db.studentStatusChange.create({
        data: {
          organizationId,
          studentId: id,
          fromStatus: existing.status,
          toStatus: 'ACTIVE',
          effectiveOn: effectiveDay(dto.effectiveOn),
          reason: dto.reason ?? 'Re-admitted',
          changedBy: actor.id,
        },
      });
      await this.audit.log(db, actor, {
        action: 'readmit',
        entity: 'student',
        entityId: id,
        ...place,
        details: { from: existing.status, effectiveOn: dto.effectiveOn, reason: dto.reason },
      });
      return this.profile(db, organizationId, id, actor);
    });
  }

  /**
   * Another section of the same branch (e.g. Regular -> JEE Mains, or JEE-A -> JEE-B) from a day:
   * the current placement ends the day before, a new one starts.
   */
  changeSection(organizationId: string, id: string, dto: ChangeSectionDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, id, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.enrolment.transfer', place);
      const { current, from } = await this.moveCurrent(
        db,
        organizationId,
        student,
        student.branchId,
        dto,
      );
      await this.audit.log(db, actor, {
        action: 'change section',
        entity: 'student',
        entityId: id,
        ...place,
        details: { from, to: current.label, effectiveOn: dto.effectiveOn, reason: dto.reason },
      });
      return this.profile(db, organizationId, id, actor);
    });
  }

  /** Another branch, and a section there, from a day (the history stays at the old branch). */
  changeBranch(organizationId: string, id: string, dto: ChangeBranchDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, id, actor);
      const toBranch = await findBranch(db, organizationId, dto.branchId);
      if (toBranch.id === student.branchId) {
        throw new BadRequestException('The student is already at this branch');
      }
      const from = placeOf(student);
      const to = { branchId: toBranch.id };
      assertCan(actor, 'students.enrolment.transfer', from);
      assertCan(actor, 'students.enrolment.transfer', to);
      if (student.status !== 'ACTIVE') {
        throw new BadRequestException('Only a current student can change branch');
      }
      const moved = await this.moveCurrent(db, organizationId, student, toBranch.id, dto);
      await db.student.update({ where: { id }, data: { branchId: toBranch.id } });
      // Logged at both branches, so both branch admins see it.
      for (const branchPlace of [from, to]) {
        await this.audit.log(db, actor, {
          action: 'change branch',
          entity: 'student',
          entityId: id,
          ...branchPlace,
          details: {
            fromBranch: from.branchId,
            toBranch: to.branchId,
            from: moved.from,
            to: moved.current.label,
            effectiveOn: dto.effectiveOn,
            reason: dto.reason,
          },
        });
      }
      return this.profile(db, organizationId, id, actor);
    });
  }

  /** For mistakes only (leaving uses "leave"). Removes enrolments, links and history too. */
  async delete(organizationId: string, id: string, actor: CurrentUser) {
    const storageKeys = await this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await findVisibleStudent(db, organizationId, id, actor);
      const place = placeOf(existing);
      assertCan(actor, 'students.student.delete', place);
      if ((await db.attendanceRecord.count({ where: { studentId: id } })) > 0) {
        throw new BadRequestException(
          'This student has attendance on record; mark them as left instead',
        );
      }
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

  // --- Helpers ---------------------------------------------------------------------------------

  /**
   * Ends the student's current placement the day before `dto.effectiveOn` and starts a new one in
   * `dto.classId` (a section of `branchId`), in the same academic year. On the placement's own
   * first day it is simply corrected instead (nothing happened in the old section yet).
   */
  private async moveCurrent(
    db: Db,
    organizationId: string,
    student: { id: string; status: string },
    branchId: string,
    dto: ChangeSectionDto,
  ) {
    if (student.status !== 'ACTIVE') {
      throw new BadRequestException('Only a current student can change section');
    }
    const current = await db.enrolment.findFirst({
      where: { studentId: student.id, status: 'ACTIVE' },
    });
    if (!current) {
      throw new BadRequestException('The student has no current section; place them in one first');
    }
    if (current.classId === dto.classId) {
      throw new BadRequestException('The student is already in this section');
    }
    const { section } = await checkPlacement(db, organizationId, branchId, {
      academicYearId: current.academicYearId,
      classId: dto.classId,
    });
    await assertRollFree(db, current.academicYearId, section.id, dto.rollNo, current.id);
    const day = effectiveDay(dto.effectiveOn, current.enrolledOn);
    const tree = await ClassTree.load(db, organizationId);
    const from = tree.label(current.classId);

    if (day.getTime() === current.enrolledOn.getTime()) {
      await db.enrolment.update({
        where: { id: current.id },
        data: { branchId, classId: section.id, rollNo: dto.rollNo ?? null, reason: dto.reason },
      });
    } else {
      await db.enrolment.update({
        where: { id: current.id },
        data: { status: 'MOVED', endedOn: dayBefore(day) },
      });
      await db.enrolment.create({
        data: {
          organizationId,
          studentId: student.id,
          academicYearId: current.academicYearId,
          branchId,
          classId: section.id,
          rollNo: dto.rollNo,
          enrolledOn: day,
          reason: dto.reason,
        },
      });
    }
    return { from, current: { label: tree.label(section.id) } };
  }

  private async checkAdmissionNoFree(db: Db, organizationId: string, admissionNo: string) {
    if (await db.student.findFirst({ where: { organizationId, admissionNo } })) {
      throw new ConflictException(`Admission number ${admissionNo} is already used`);
    }
  }

  private async checkAadhaarFree(db: Db, organizationId: string, aadhaar: string) {
    const owner = await db.student.findFirst({ where: { organizationId, aadhaar } });
    if (owner) {
      throw new ConflictException(
        `This Aadhaar number is already used by student ${owner.admissionNo}`,
      );
    }
  }

  /**
   * The full profile: details, branch, guardians, logins, every placement (with its place in the
   * structure, oldest last), the status history, and the import it came from; the screen draws
   * the timeline from them. Sensitive details only with "students.sensitive.view".
   */
  private async profile(db: Db, organizationId: string, id: string, actor: CurrentUser) {
    const [student, tree] = await Promise.all([
      db.student.findUniqueOrThrow({
        where: { id },
        include: {
          branch: { select: { id: true, name: true, status: true } },
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
            orderBy: [{ enrolledOn: 'desc' }, { createdAt: 'desc' }],
            include: {
              academicYear: { select: { id: true, name: true, status: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          statusChanges: { orderBy: [{ effectiveOn: 'desc' }, { changedAt: 'desc' }] },
          importRun: { select: { id: true, number: true } },
        },
      }),
      ClassTree.load(db, organizationId),
    ]);
    const sensitiveVisible = can(actor, 'students.sensitive.view', placeOf(student));
    const { importRun, ...rest } = student;
    return {
      ...rest,
      ...(!sensitiveVisible && {
        aadhaar: maskAadhaar(student.aadhaar),
        category: null,
        subCaste: null,
        medicalCondition: null,
      }),
      sensitiveVisible,
      importedFrom: importRun
        ? {
            id: importRun.id,
            code: `IMP-${String(importRun.number).padStart(4, '0')}`,
            row: student.importRow,
          }
        : null,
      enrolments: student.enrolments.map((e) => ({
        ...e,
        section: tree.label(e.classId),
        path: tree.path(e.classId).map((c) => ({ id: c.id, name: c.name, level: c.level })),
      })),
    };
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
