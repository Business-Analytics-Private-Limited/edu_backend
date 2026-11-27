/**
 * SYLLABUS (ADR-0037): the chapters of each subject, in teaching order. Exams tick the chapters
 * they cover (Evaluation module, `exam_subjects.chapter_ids`).
 *
 * Rules:
 *   - chapters belong to the organization's subject list, so they are managed with
 *     "academic.subject.update" for the whole organization and read with "academic.subject.view";
 *   - names are unique within a subject;
 *   - a chapter an exam has ticked can't be deleted: switch it off instead (it then stays on
 *     those exams but isn't offered for new ones).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, canSomewhere } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AddChaptersDto, ReorderChaptersDto, UpdateChapterDto } from './dto/academic.dto';

const WHOLE_ORGANIZATION = {};

@Injectable()
export class ChaptersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A subject's chapters in order (switched-off ones too, marked). */
  list(organizationId: string, subjectId: string, actor: CurrentUser) {
    if (!canSomewhere(actor, 'academic.subject.view'))
      throw new NotFoundException('Subject not found');
    return this.prisma.forOrganization(organizationId, async (db) => {
      const subject = await this.findSubject(db, organizationId, subjectId);
      const chapters = await db.chapter.findMany({
        where: { subjectId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, sortOrder: true, isActive: true },
      });
      return { subject: { id: subject.id, code: subject.code, name: subject.name }, chapters };
    });
  }

  /** Adds chapters after the existing ones. */
  add(organizationId: string, subjectId: string, dto: AddChaptersDto, actor: CurrentUser) {
    assertCan(actor, 'academic.subject.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const subject = await this.findSubject(db, organizationId, subjectId);
      const names = dto.names.map((n) => n.trim()).filter(Boolean);
      const lower = names.map((n) => n.toLowerCase());
      if (new Set(lower).size !== lower.length)
        throw new BadRequestException('A chapter name appears twice');
      const existing = await db.chapter.findMany({ where: { subjectId } });
      const taken = existing.find((c) => lower.includes(c.name.toLowerCase()));
      if (taken)
        throw new ConflictException(`${subject.name} already has the chapter "${taken.name}"`);
      const start = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
      await db.chapter.createMany({
        data: names.map((name, i) => ({ organizationId, subjectId, name, sortOrder: start + i })),
      });
      await this.audit.log(db, actor, {
        action: 'add chapters',
        entity: 'subject',
        entityId: subjectId,
        details: { subject: subject.code, chapters: names },
      });
      return { added: names.length };
    });
  }

  update(organizationId: string, id: string, dto: UpdateChapterDto, actor: CurrentUser) {
    assertCan(actor, 'academic.subject.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const chapter = await this.findChapter(db, organizationId, id);
      const name = dto.name?.trim();
      if (name && name.toLowerCase() !== chapter.name.toLowerCase()) {
        const clash = await db.chapter.findFirst({
          where: { subjectId: chapter.subjectId, name: { equals: name, mode: 'insensitive' } },
        });
        if (clash)
          throw new ConflictException(`This subject already has the chapter "${clash.name}"`);
      }
      const updated = await db.chapter.update({
        where: { id },
        data: { name, isActive: dto.isActive },
        select: { id: true, name: true, sortOrder: true, isActive: true },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'chapter',
        entityId: id,
        details: { from: chapter.name, ...dto },
      });
      return updated;
    });
  }

  /** Puts the subject's chapters in the given order. */
  reorder(organizationId: string, subjectId: string, dto: ReorderChaptersDto, actor: CurrentUser) {
    assertCan(actor, 'academic.subject.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      await this.findSubject(db, organizationId, subjectId);
      const chapters = await db.chapter.findMany({ where: { subjectId }, select: { id: true } });
      const ids = new Set(chapters.map((c) => c.id));
      if (dto.chapterIds.length !== ids.size || dto.chapterIds.some((id) => !ids.has(id))) {
        throw new BadRequestException("List every chapter of the subject, and only the subject's");
      }
      for (const [i, id] of dto.chapterIds.entries()) {
        await db.chapter.update({ where: { id }, data: { sortOrder: i } });
      }
      await this.audit.log(db, actor, {
        action: 'reorder chapters',
        entity: 'subject',
        entityId: subjectId,
        details: { chapters: dto.chapterIds.length },
      });
      return { reordered: dto.chapterIds.length };
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    assertCan(actor, 'academic.subject.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const chapter = await this.findChapter(db, organizationId, id);
      // Exams keep chapter ids as plain ids (ADR-0035), so the check is a query, not a foreign key.
      const used = await db.examSubject.count({ where: { chapterIds: { has: id } } });
      if (used > 0) {
        throw new BadRequestException(
          `${used} exam subject(s) cover this chapter: switch it off instead of deleting it`,
        );
      }
      await db.chapter.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'chapter',
        entityId: id,
        details: { name: chapter.name },
      });
      return { deleted: true };
    });
  }

  private async findSubject(db: Db, organizationId: string, id: string) {
    const subject = await db.subject.findFirst({ where: { id, organizationId } });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  private async findChapter(db: Db, organizationId: string, id: string) {
    const chapter = await db.chapter.findFirst({ where: { id, organizationId } });
    if (!chapter) throw new NotFoundException('Chapter not found');
    return chapter;
  }
}
