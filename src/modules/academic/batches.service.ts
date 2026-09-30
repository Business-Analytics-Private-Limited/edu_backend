/**
 * BATCHES: students who joined together and move on together, e.g. "2026-28" or
 * "Long term 2026". Each batch belongs to an institution and has a STAGE in the institution's
 * own words (e.g. Junior -> Senior -> Passed out); promotion (Students module) will move
 * batches to their next stage.
 *
 * Managing batches needs the permission for the institution; people working in one campus of
 * it may view them.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, canSomewhereIn } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateBatchDto, UpdateBatchDto } from './dto/academic.dto';

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, actor: CurrentUser, institutionId?: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const batches = await db.batch.findMany({
        where: { organizationId, ...(institutionId && { institutionId }) },
        orderBy: [{ status: 'asc' }, { name: 'desc' }],
        include: { institution: { select: { id: true, name: true } } },
      });
      return batches.filter((b) => canSomewhereIn(actor, 'academic.batch.view', b.institutionId));
    });
  }

  create(organizationId: string, dto: CreateBatchDto, actor: CurrentUser) {
    const place = { institutionId: dto.institutionId };
    assertCan(actor, 'academic.batch.create', place);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institution = await db.institution.findFirst({
        where: { id: dto.institutionId, organizationId },
      });
      if (!institution) throw new NotFoundException('Institution not found');
      const batch = await db.batch.create({
        data: { ...dto, organizationId, stage: dto.stage.trim() },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'batch',
        entityId: batch.id,
        ...place,
        details: { name: batch.name, code: batch.code, stage: batch.stage },
      });
      return batch;
    });
  }

  update(organizationId: string, id: string, dto: UpdateBatchDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findBatch(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'academic.batch.update', place);
      const batch = await db.batch.update({
        where: { id },
        data: { ...dto, stage: dto.stage?.trim() },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'batch',
        entityId: id,
        ...place,
        details: { ...dto },
      });
      return batch;
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const existing = await this.findBatch(db, organizationId, id);
      const place = { institutionId: existing.institutionId };
      assertCan(actor, 'academic.batch.delete', place);
      // Later, once students join batches: refuse while a batch has students.
      await db.batch.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'batch',
        entityId: id,
        ...place,
        details: { name: existing.name, code: existing.code },
      });
      return { deleted: true };
    });
  }

  private async findBatch(db: Db, organizationId: string, id: string) {
    const batch = await db.batch.findFirst({ where: { id, organizationId } });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }
}
