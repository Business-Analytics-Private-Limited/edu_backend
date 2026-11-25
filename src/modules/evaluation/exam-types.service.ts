/**
 * EXAM TYPES (ADR-0035): the organization's kinds of exam, e.g. Weekly test (WT), Quarterly (Q),
 * Half-yearly (HY), Grand test (GT). Name and code are unique in the organization.
 *
 * For the whole organization: changing them needs "evaluation.settings.update" there; anyone who
 * may see exams somewhere may list them. A type in use by an exam can't be deleted: switch it
 * off (isActive) instead, so it is no longer offered for new exams.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, canSomewhere } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateExamTypeDto, UpdateExamTypeDto } from './dto/evaluation.dto';

const WHOLE_ORGANIZATION = {};

@Injectable()
export class ExamTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Every type, in display order, with how many exams use it. */
  list(organizationId: string, actor: CurrentUser) {
    if (
      !canSomewhere(actor, 'evaluation.exam.view') &&
      !canSomewhere(actor, 'evaluation.settings.view')
    ) {
      return Promise.resolve([]);
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      const types = await db.examType.findMany({
        where: { organizationId },
        include: { _count: { select: { exams: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      return types.map(({ _count, ...t }) => ({ ...t, examCount: _count.exams }));
    });
  }

  create(organizationId: string, dto: CreateExamTypeDto, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const type = await db.examType.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          code: dto.code.trim().toUpperCase(),
          description: dto.description?.trim() || null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'exam_type',
        entityId: type.id,
        details: { name: type.name, code: type.code },
      });
      return type;
    });
  }

  update(organizationId: string, id: string, dto: UpdateExamTypeDto, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.find(db, organizationId, id);
      const type = await db.examType.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          code: dto.code?.trim().toUpperCase(),
          description: dto.description === undefined ? undefined : dto.description.trim() || null,
          isActive: dto.isActive,
          sortOrder: dto.sortOrder,
        },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'exam_type',
        entityId: id,
        details: { ...dto },
      });
      return type;
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const type = await this.find(db, organizationId, id);
      const used = await db.exam.count({ where: { examTypeId: id } });
      if (used > 0) {
        throw new BadRequestException(
          `${used} exam(s) use "${type.name}": switch it off instead, so it isn't offered for new exams`,
        );
      }
      await db.examType.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'exam_type',
        entityId: id,
        details: { name: type.name, code: type.code },
      });
      return { deleted: true };
    });
  }

  private async find(db: Db, organizationId: string, id: string) {
    const type = await db.examType.findFirst({ where: { id, organizationId } });
    if (!type) throw new NotFoundException('Exam type not found');
    return type;
  }
}
