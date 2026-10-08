/**
 * GUARDIANS: a student's parents / guardians.
 *
 * A guardian is a person on record once and can be linked to several students (siblings):
 * adding the second child's mother links the existing record instead of a copy. Changing a
 * guardian's name or phone therefore changes it for all their children.
 *
 * Rules: changing a student's guardians needs "students.student.update" at the student's branch;
 * one guardian per student is the PRIMARY contact; a guardian no longer linked to any student
 * is removed.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, inReach, reachOf } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { GuardianDto, UpdateGuardianDto } from './dto/student.dto';
import { findVisibleStudent, placeOf } from './placement';

@Injectable()
export class GuardiansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Guardians on record with this phone, and their (visible) children; to link siblings. */
  search(organizationId: string, phone: string, actor: CurrentUser) {
    const reach = reachOf(actor, 'students.student.view');
    return this.prisma.forOrganization(organizationId, async (db) => {
      const guardians = await db.guardian.findMany({
        where: { organizationId, phone: { contains: phone } },
        include: {
          students: {
            include: {
              student: {
                select: { id: true, fullName: true, admissionNo: true, branchId: true },
              },
            },
          },
        },
        take: 20,
      });
      // Only guardians of students the user may see.
      return guardians
        .map((g) => ({
          ...g,
          students: g.students.filter(({ student }) =>
            inReach(reach, { branchId: student.branchId }),
          ),
        }))
        .filter((g) => g.students.length > 0);
    });
  }

  add(organizationId: string, studentId: string, dto: GuardianDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.student.update', place);
      const link = await this.link(db, organizationId, studentId, dto);
      await this.audit.log(db, actor, {
        action: 'add guardian',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { guardian: link.guardian.fullName, relation: link.relation },
      });
      return link;
    });
  }

  update(
    organizationId: string,
    studentId: string,
    guardianId: string,
    dto: UpdateGuardianDto,
    actor: CurrentUser,
  ) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.student.update', place);
      const link = await this.findLink(db, studentId, guardianId);

      const { relation, isPrimary, ...person } = dto;
      if (Object.keys(person).length > 0) {
        await db.guardian.update({ where: { id: guardianId }, data: person });
      }
      if (isPrimary) await this.clearPrimary(db, studentId);
      const updated = await db.studentGuardian.update({
        where: { id: link.id },
        data: { relation, isPrimary },
        include: { guardian: true },
      });
      await this.audit.log(db, actor, {
        action: 'update guardian',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { guardian: updated.guardian.fullName, ...dto },
      });
      return updated;
    });
  }

  remove(organizationId: string, studentId: string, guardianId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const student = await findVisibleStudent(db, organizationId, studentId, actor);
      const place = placeOf(student);
      assertCan(actor, 'students.student.update', place);
      const link = await this.findLink(db, studentId, guardianId);
      await db.studentGuardian.delete({ where: { id: link.id } });
      await db.guardian.deleteMany({ where: { id: guardianId, students: { none: {} } } });
      await this.audit.log(db, actor, {
        action: 'remove guardian',
        entity: 'student',
        entityId: studentId,
        ...place,
        details: { guardian: link.guardian.fullName },
      });
      return { removed: true };
    });
  }

  /**
   * Links a guardian to a student: an existing one (by id) or a new person. Used at admission
   * too, inside the same transaction. The first guardian becomes primary.
   */
  async link(db: Db, organizationId: string, studentId: string, dto: GuardianDto) {
    let guardianId = dto.existingGuardianId;
    if (guardianId) {
      const existing = await db.guardian.findFirst({ where: { id: guardianId, organizationId } });
      if (!existing) throw new NotFoundException('Guardian not found');
      if (await db.studentGuardian.findFirst({ where: { studentId, guardianId } })) {
        throw new ConflictException('This guardian is already linked to the student');
      }
    } else {
      if (!dto.fullName) throw new BadRequestException('A new guardian needs a name');
      const created = await db.guardian.create({
        data: {
          organizationId,
          fullName: dto.fullName,
          phone: dto.phone,
          email: dto.email,
          occupation: dto.occupation,
        },
      });
      guardianId = created.id;
    }
    const hasGuardians = (await db.studentGuardian.count({ where: { studentId } })) > 0;
    const isPrimary = dto.isPrimary ?? !hasGuardians;
    if (isPrimary) await this.clearPrimary(db, studentId);
    return db.studentGuardian.create({
      data: { organizationId, studentId, guardianId, relation: dto.relation, isPrimary },
      include: { guardian: true },
    });
  }

  private async clearPrimary(db: Db, studentId: string) {
    await db.studentGuardian.updateMany({ where: { studentId }, data: { isPrimary: false } });
  }

  private async findLink(db: Db, studentId: string, guardianId: string) {
    const link = await db.studentGuardian.findFirst({
      where: { studentId, guardianId },
      include: { guardian: true },
    });
    if (!link) throw new NotFoundException('This guardian is not linked to the student');
    return link;
  }
}
