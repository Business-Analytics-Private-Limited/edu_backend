/**
 * SUBJECTS: the organization's list of subjects (Mathematics, Physics, ...), and which subjects
 * each class has.
 *
 * A subject is attached to a class at ANY level and the classes below inherit it: attach
 * Mathematics to "MPC" and every MPC section of every branch has Mathematics. So a class's
 * subjects are its own plus those of the classes above it.
 *
 * Rules:
 *   - the subject list belongs to the whole organization ("academic.subject.*" for the whole
 *     organization); anyone with "academic.subject.view" may see it;
 *   - attaching subjects to a class is part of the structure: "academic.structure.update" for
 *     the whole organization, or at the branch for a section;
 *   - a subject that classes use can't be deleted (set it "not in use" instead).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, canSomewhere } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClassTree } from './class-tree';
import { CreateSubjectDto, SetClassSubjectsDto, UpdateSubjectDto } from './dto/academic.dto';

const WHOLE_ORGANIZATION = {};

@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- The subject list ------------------------------------------------------------------------

  list(organizationId: string, actor: CurrentUser) {
    if (!canSomewhere(actor, 'academic.subject.view')) return Promise.resolve([]);
    return this.prisma.forOrganization(organizationId, (db) =>
      db.subject.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { classes: true } } },
      }),
    );
  }

  create(organizationId: string, dto: CreateSubjectDto, actor: CurrentUser) {
    assertCan(actor, 'academic.subject.create', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const subject = await db.subject.create({ data: { ...dto, organizationId } });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'subject',
        entityId: subject.id,
        details: { name: subject.name, code: subject.code },
      });
      return subject;
    });
  }

  update(organizationId: string, id: string, dto: UpdateSubjectDto, actor: CurrentUser) {
    assertCan(actor, 'academic.subject.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findSubject(db, organizationId, id);
      const subject = await db.subject.update({ where: { id }, data: dto });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'subject',
        entityId: id,
        details: { ...dto },
      });
      return subject;
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    assertCan(actor, 'academic.subject.delete', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findSubject(db, organizationId, id);
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
        details: { name: existing.name },
      });
      return { deleted: true };
    });
  }

  // --- Subjects of a class ------------------------------------------------------------------------

  /**
   * A class's subjects: its own, and those inherited from the classes above it; plus the
   * organization's subject list to choose from.
   */
  forClass(organizationId: string, classId: string, actor: CurrentUser) {
    if (!canSomewhere(actor, 'academic.structure.view')) {
      throw new NotFoundException('Class not found');
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      const tree = await ClassTree.load(db, organizationId);
      const found = tree.get(classId);
      if (!found) throw new NotFoundException('Class not found');
      const ancestors = tree.path(classId).slice(0, -1);
      const links = await db.classSubject.findMany({
        where: { classId: { in: [found.id, ...ancestors.map((a) => a.id)] } },
        include: { subject: true },
      });
      const available = await db.subject.findMany({
        where: { organizationId, isActive: true },
        orderBy: { name: 'asc' },
      });
      return {
        class: { id: found.id, name: found.name, code: found.code, branchId: found.branchId },
        path: ancestors.map((a) => ({ id: a.id, name: a.name })),
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
      const found = await db.class.findFirst({ where: { id: classId, organizationId } });
      if (!found) throw new NotFoundException('Class not found');
      const place = { branchId: found.branchId };
      assertCan(actor, 'academic.structure.update', place);

      const subjects = await db.subject.findMany({
        where: { id: { in: dto.subjectIds }, organizationId },
      });
      if (subjects.length !== dto.subjectIds.length) {
        throw new BadRequestException("Every subject must be one of the organization's subjects");
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

  private async findSubject(db: Db, organizationId: string, id: string) {
    const subject = await db.subject.findFirst({ where: { id, organizationId } });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }
}
