/**
 * GRADING SCHEMES (ADR-0036): the organization's lists of grades (see grading.ts).
 *
 * Rules:
 *   - schemes belong to the whole organization: managed with "evaluation.settings.update",
 *     read by anyone who may see exams;
 *   - names are unique; at most one scheme is the default (used by exams that name none);
 *   - one band starts at 0 %; grades and starting percentages are unique within a scheme;
 *   - a scheme that exams use can't be deleted.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, canSomewhere } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateGradingSchemeDto,
  GradingBandDto,
  UpdateGradingSchemeDto,
} from './dto/evaluation.dto';
import { bandsProblem, toScheme } from './grading';

const WHOLE_ORGANIZATION = {};
const WITH_BANDS = { bands: true, _count: { select: { exams: true } } } as const;

@Injectable()
export class GradingSchemesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(organizationId: string, actor: CurrentUser) {
    if (!canSomewhere(actor, 'evaluation.exam.view')) return Promise.resolve([]);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const rows = await db.gradingScheme.findMany({
        where: { organizationId },
        include: WITH_BANDS,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      });
      return rows.map(view);
    });
  }

  create(organizationId: string, dto: CreateGradingSchemeDto, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    this.checkBands(dto.bands);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const isDefault =
        dto.isDefault ?? (await db.gradingScheme.count({ where: { organizationId } })) === 0;
      if (isDefault) await this.clearDefault(db, organizationId);
      const scheme = await db.gradingScheme.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          isDefault,
          bands: { create: bandRows(organizationId, dto.bands) },
        },
        include: WITH_BANDS,
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'grading_scheme',
        entityId: scheme.id,
        details: { name: scheme.name, grades: dto.bands.map((b) => b.grade) },
      });
      return view(scheme);
    });
  }

  update(organizationId: string, id: string, dto: UpdateGradingSchemeDto, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    if (dto.bands) this.checkBands(dto.bands);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.find(db, organizationId, id);
      if (dto.isDefault) await this.clearDefault(db, organizationId);
      if (dto.bands) {
        await db.gradingBand.deleteMany({ where: { gradingSchemeId: id } });
        await db.gradingBand.createMany({
          data: bandRows(organizationId, dto.bands).map((b) => ({ ...b, gradingSchemeId: id })),
        });
      }
      const scheme = await db.gradingScheme.update({
        where: { id },
        data: { name: dto.name?.trim(), isDefault: dto.isDefault },
        include: WITH_BANDS,
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'grading_scheme',
        entityId: id,
        details: {
          name: scheme.name,
          isDefault: dto.isDefault,
          grades: dto.bands?.map((b) => b.grade),
        },
      });
      return view(scheme);
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const scheme = await this.find(db, organizationId, id);
      const exams = await db.exam.count({ where: { gradingSchemeId: id } });
      if (exams > 0) {
        throw new BadRequestException(
          `${exams} exam(s) use this scheme: choose another one for them first`,
        );
      }
      await db.gradingScheme.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'grading_scheme',
        entityId: id,
        details: { name: scheme.name },
      });
      return { deleted: true };
    });
  }

  private checkBands(bands: GradingBandDto[]) {
    const problem = bandsProblem(bands);
    if (problem) throw new BadRequestException(problem);
  }

  private async clearDefault(db: Db, organizationId: string) {
    await db.gradingScheme.updateMany({
      where: { organizationId, isDefault: true },
      data: { isDefault: false },
    });
  }

  private async find(db: Db, organizationId: string, id: string) {
    const scheme = await db.gradingScheme.findFirst({ where: { id, organizationId } });
    if (!scheme) throw new NotFoundException('Grading scheme not found');
    return scheme;
  }
}

function bandRows(organizationId: string, bands: GradingBandDto[]) {
  return bands.map((b) => ({
    organizationId,
    grade: b.grade.trim(),
    minPercentage: b.minPercentage,
    gradePoint: b.gradePoint ?? null,
    remark: b.remark?.trim() || null,
  }));
}

function view(row: {
  id: string;
  name: string;
  isDefault: boolean;
  bands: { grade: string; minPercentage: unknown; gradePoint: unknown; remark: string | null }[];
  _count: { exams: number };
}) {
  return { ...toScheme(row), isDefault: row.isDefault, examCount: row._count.exams };
}
