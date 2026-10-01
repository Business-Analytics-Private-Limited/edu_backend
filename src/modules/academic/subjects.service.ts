/**
 * SUBJECTS: each institution's list of subjects (Mathematics, Physics, ...), and which subjects
 * each class has.
 *
 * A subject is attached to a class at ANY level and the classes below inherit it: attach
 * Mathematics to "MPC" and every MPC section has Mathematics. So a class's subjects are its own
 * plus those of the classes above it.
 *
 * Rules:
 *   - the subject list is managed for the institution ("academic.subject.*": a Principal or an
 *     organization-wide admin); everyone working in the institution may see it;
 *   - attaching subjects to a class is part of building the class structure, so it needs
 *     "academic.structure.update" at the class's campus (a Campus admin does it for their campus);
 *   - a subject that classes use can't be deleted (set it "not in use" instead).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhereIn } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSubjectDto, SetClassSubjectsDto, UpdateSubjectDto } from './dto/academic.dto';

@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- The subject list ------------------------------------------------------------------------

  list(organizationId: string, actor: CurrentUser, institutionId?: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const subjects = await db.subject.findMany({
        where: { organizationId, ...(institutionId && { institutionId }) },
        orderBy: { name: 'asc' },
        include: {
          institution: { select: { id: true, name: true } },
          _count: { select: { classes: true } },
        },
      });
      return subjects.filter((s) =>
        canSomewhereIn(actor, 'academic.subject.view', s.institutionId),
      );
    });
  }

  create(organizationId: string, dto: CreateSubjectDto, actor: CurrentUser) {
    const place = { institutionId: dto.institutionId };
    assertCan(actor, 'academic.subject.create', place);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institution = await db.institution.findFirst({
        where: { id: dto.institutionId, organizationId },
      });
      if (!institution) throw new NotFoundException('Institution not found');
      const subject = await db.subject.create({ data: { ...dto, organizationId } });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'subject',
        entityId: subject.id,
        ...place,
        details: { name: subject.name, code: subject.code },
      });
      return subject;
    });
  }

  update(organizationId: string, id: string, dto: UpdateSubjectDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findSubject(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'academic.subject.update', place);
      const subject = await db.subject.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'subject',
        entityId: id,
        ...place,
        details: { ...dto },
      });
      return subject;
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findSubject(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'academic.subject.delete', place);
      if ((await db.classSubject.count({ where: { subjectId: id } })) > 0) {
        throw new BadRequestException(
          'Classes still have this subject; take it off them first, or mark it "not in use"',
        );
      }
      await db.subject.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'subject',
        entityId: id,
        ...place,
        details: { name: existing.name },
      });
      return { deleted: true };
    });
  }

  // --- Subjects of a class ------------------------------------------------------------------------

  /**
   * A class's subjects: its own, and those inherited from the classes above it; plus the
   * institution's subject list to choose from.
   */
  forClass(organizationId: string, classId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const found = await this.findClass(db, organizationId, classId);
      if (!can(actor, 'academic.structure.view', placeOf(found))) {
        throw new NotFoundException('Class not found');
      }
      const ancestors = await this.ancestorsOf(db, found);
      const links = await db.classSubject.findMany({
        where: { classId: { in: [found.id, ...ancestors.map((a) => a.id)] } },
        include: { subject: true },
      });
      const available = await db.subject.findMany({
        where: { institutionId: found.institutionId, isActive: true },
        orderBy: { name: 'asc' },
      });
      return {
        class: { id: found.id, name: found.name, code: found.code, campusId: found.campusId },
        path: [...ancestors].reverse().map((a) => ({ id: a.id, name: a.name })),
        own: links.filter((l) => l.classId === found.id).map((l) => l.subject),
        inherited: links
          .filter((l) => l.classId !== found.id)
          .map((l) => ({
            subject: l.subject,
            from: { id: l.classId, name: ancestors.find((a) => a.id === l.classId)?.name ?? '' },
          })),
        available,
      };
    });
  }

  /** Replaces the class's OWN subjects (inherited ones stay as they are). */
  setForClass(
    organizationId: string,
    classId: string,
    dto: SetClassSubjectsDto,
    actor: CurrentUser,
  ) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const found = await this.findClass(db, organizationId, classId);
      const place = placeOf(found);
      assertCan(actor, 'academic.structure.update', place);

      const subjects = await db.subject.findMany({
        where: { id: { in: dto.subjectIds }, institutionId: found.institutionId },
      });
      if (subjects.length !== dto.subjectIds.length) {
        throw new BadRequestException("Every subject must be one of this institution's subjects");
      }
      await db.classSubject.deleteMany({ where: { classId } });
      await db.classSubject.createMany({
        data: dto.subjectIds.map((subjectId) => ({ organizationId, classId, subjectId })),
      });
      await this.audit.log(db, actor, {
        action: 'set subjects',
        entity: 'class',
        entityId: classId,
        ...place,
        details: { class: found.name, subjects: subjects.map((s) => s.code) },
      });
      return subjects;
    });
  }

  // --- Helpers ---------------------------------------------------------------------------------

  /** The classes above this one, nearest first. */
  private async ancestorsOf(db: Db, found: { parentId: string | null }) {
    const ancestors: { id: string; name: string; parentId: string | null }[] = [];
    let parentId = found.parentId;
    while (parentId) {
      const parent = await db.class.findUniqueOrThrow({
        where: { id: parentId },
        select: { id: true, name: true, parentId: true },
      });
      ancestors.push(parent);
      parentId = parent.parentId;
    }
    return ancestors;
  }

  private async findSubject(db: Db, organizationId: string, id: string) {
    const subject = await db.subject.findFirst({ where: { id, organizationId } });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  private async findClass(db: Db, organizationId: string, id: string) {
    const found = await db.class.findFirst({ where: { id, organizationId } });
    if (!found) throw new NotFoundException('Class not found');
    return found;
  }
}

function placeOf(c: { institutionId: string; campusId: string }) {
  return { institutionId: c.institutionId, campusId: c.campusId };
}
