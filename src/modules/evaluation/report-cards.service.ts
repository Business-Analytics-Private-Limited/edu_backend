/**
 * REPORT CARDS (ADR-0036): the organization's report card settings (title, header line,
 * signatures, footer, logo) and the cards themselves as PDF: one student, or in bulk for a
 * section, a branch, or every section the user may see.
 *
 * Who may do what:
 *   - settings: read by anyone who may see exams; changed with "evaluation.settings.update"
 *     for the whole organization;
 *   - a card: "evaluation.marks.view" at the student's branch (staff), or a parent / student
 *     linked to the student, only for a LOCKED exam (portal, see PortalService);
 *   - bulk: only the sections at branches where the user has "evaluation.marks.view".
 *
 * Cards show what the results screen shows (computeResults), so ranks and grades always agree.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhere } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FilesService, type Upload } from '../files/files.service';
import { ReportCardSettingsDto, ReportCardsQuery } from './dto/evaluation.dto';
import { examContext } from './exams.service';
import { computeResults, type ExamContext } from './marks.service';
import { reportCardsPdf, type ReportCardData } from './report-card-pdf';

const WHOLE_ORGANIZATION = {};
const DEFAULTS = {
  title: 'Progress report',
  headerLine: null as string | null,
  footerNote: null as string | null,
  signatureLabels: ['Class teacher', 'Principal', 'Parent'],
  logoFileId: null as string | null,
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const iso = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class ReportCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  // --- settings ------------------------------------------------------------------------------------

  getSettings(organizationId: string, actor: CurrentUser) {
    if (!canSomewhere(actor, 'evaluation.exam.view')) throw new NotFoundException('Not found');
    return this.prisma.forOrganization(organizationId, async (db) => {
      const s = await this.settingsOf(db, organizationId);
      const { logoFileId, ...rest } = s;
      return { ...rest, hasLogo: logoFileId !== null };
    });
  }

  updateSettings(organizationId: string, dto: ReportCardSettingsDto, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const data = {
        title: dto.title?.trim(),
        headerLine: dto.headerLine === undefined ? undefined : dto.headerLine.trim() || null,
        footerNote: dto.footerNote === undefined ? undefined : dto.footerNote.trim() || null,
        signatureLabels: dto.signatureLabels?.map((l) => l.trim()),
      };
      await db.reportCardSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...DEFAULTS, ...stripUndefined(data) },
        update: data,
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'report_card_settings',
        entityId: organizationId,
        details: { ...dto },
      });
      return this.getSettingsIn(db, organizationId);
    });
  }

  /** Sets the logo: a PNG or JPG, at most 5 MB. The old logo's file is removed. */
  async setLogo(organizationId: string, upload: Upload | undefined, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    const head = upload?.buffer?.subarray(0, 4);
    if (upload && head && !head.subarray(0, 4).equals(PNG) && !head.subarray(0, 3).equals(JPEG)) {
      throw new BadRequestException('The logo must be a PNG or JPG image');
    }
    const oldKeys: string[] = [];
    const result = await this.prisma.forOrganization(organizationId, async (db) => {
      const file = await this.files.save(db, organizationId, upload, actor);
      const current = await db.reportCardSettings.findUnique({ where: { organizationId } });
      if (current?.logoFileId) {
        const old = await db.storedFile.findFirst({ where: { id: current.logoFileId } });
        if (old) {
          oldKeys.push(old.storageKey);
          await db.storedFile.delete({ where: { id: old.id } });
        }
      }
      await db.reportCardSettings.upsert({
        where: { organizationId },
        create: { organizationId, ...DEFAULTS, logoFileId: file.id },
        update: { logoFileId: file.id },
      });
      await this.audit.log(db, actor, {
        action: 'set logo',
        entity: 'report_card_settings',
        entityId: organizationId,
        details: { file: file.originalName },
      });
      return { hasLogo: true };
    });
    await this.files.removeLater(oldKeys);
    return result;
  }

  async removeLogo(organizationId: string, actor: CurrentUser) {
    assertCan(actor, 'evaluation.settings.update', WHOLE_ORGANIZATION);
    const oldKeys: string[] = [];
    await this.prisma.forOrganization(organizationId, async (db) => {
      const current = await db.reportCardSettings.findUnique({ where: { organizationId } });
      if (!current?.logoFileId) return;
      const old = await db.storedFile.findFirst({ where: { id: current.logoFileId } });
      await db.reportCardSettings.update({ where: { organizationId }, data: { logoFileId: null } });
      if (old) {
        oldKeys.push(old.storageKey);
        await db.storedFile.delete({ where: { id: old.id } });
      }
      await this.audit.log(db, actor, {
        action: 'remove logo',
        entity: 'report_card_settings',
        entityId: organizationId,
        details: {},
      });
    });
    await this.files.removeLater(oldKeys);
    return { hasLogo: false };
  }

  /** The logo, to show on the settings screen. */
  logo(organizationId: string, actor: CurrentUser) {
    if (!canSomewhere(actor, 'evaluation.exam.view')) throw new NotFoundException('No logo');
    return this.prisma.forOrganization(organizationId, async (db) => {
      const s = await this.settingsOf(db, organizationId);
      if (!s.logoFileId) throw new NotFoundException('No logo');
      return this.files.open(db, s.logoFileId);
    });
  }

  // --- cards ---------------------------------------------------------------------------------------

  /** One student's card (staff). */
  one(organizationId: string, examId: string, studentId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const ctx = await examContext(db, organizationId, examId, actor);
      const cards = await this.cardsOf(db, organizationId, ctx, (p) => p.studentId === studentId);
      if (cards.length === 0) throw new NotFoundException('That student is not in this exam');
      assertCan(actor, 'evaluation.marks.view', { branchId: cards[0].branchId });
      return { pdf: await reportCardsPdf([cards[0].data]), fileName: fileName(ctx, cards[0].data) };
    });
  }

  /** Many cards in one PDF: a section, a branch, or every section the user may see. */
  bulk(organizationId: string, examId: string, query: ReportCardsQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(
      organizationId,
      async (db) => {
        const ctx = await examContext(db, organizationId, examId, actor);
        if (query.sectionId && !ctx.sections.some((s) => s.id === query.sectionId)) {
          throw new BadRequestException('That section is not part of this exam');
        }
        const allowed = (branchId: string) => can(actor, 'evaluation.marks.view', { branchId });
        if (query.sectionId) {
          assertCan(actor, 'evaluation.marks.view', {
            branchId: ctx.sections.find((s) => s.id === query.sectionId)!.branchId,
          });
        }
        if (query.branchId) assertCan(actor, 'evaluation.marks.view', { branchId: query.branchId });
        const cards = await this.cardsOf(
          db,
          organizationId,
          ctx,
          (p) =>
            allowed(p.branchId) &&
            (!query.sectionId || p.classId === query.sectionId) &&
            (!query.branchId || p.branchId === query.branchId),
        );
        await this.audit.log(db, actor, {
          action: 'print report cards',
          entity: 'exam',
          entityId: examId,
          branchId: query.branchId ?? ctx.exam.branchId,
          details: { exam: ctx.exam.name, cards: cards.length, sectionId: query.sectionId },
        });
        const label = query.sectionId
          ? ctx.sections.find((s) => s.id === query.sectionId)!.label
          : 'all';
        return {
          pdf: await reportCardsPdf(cards.map((c) => c.data)),
          fileName: safe(`${ctx.exam.name} ${label} report cards.pdf`),
          count: cards.length,
        };
      },
      { timeoutMs: 120_000 },
    );
  }

  /**
   * A card for the portal: the caller has already checked that the login is linked to the
   * student. Only LOCKED exams (results are final) are shown to parents and students.
   */
  forPortal(organizationId: string, examId: string, studentId: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const ctx = await portalContext(db, organizationId, examId);
      const cards = await this.cardsOf(db, organizationId, ctx, (p) => p.studentId === studentId);
      if (cards.length === 0) throw new NotFoundException('Exam not found');
      return { pdf: await reportCardsPdf([cards[0].data]), fileName: fileName(ctx, cards[0].data) };
    });
  }

  /** The portal's list: the student's LOCKED exams, newest first, with the overall result. */
  portalExams(organizationId: string, studentId: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const marked = await db.examMark.findMany({
        where: { studentId, exam: { status: 'LOCKED' } },
        distinct: ['examId'],
        select: { examId: true },
      });
      const list = [];
      for (const { examId } of marked) {
        const result = await this.portalResultIn(db, organizationId, examId, studentId);
        // The list shows the overall result only; the subjects are on the exam's own page.
        if (result) list.push({ ...result, subjects: undefined });
      }
      return list.sort((a, b) => b.exam.startsOn.localeCompare(a.exam.startsOn));
    });
  }

  /** The portal's view of one exam: the student's marks per subject and the overall result. */
  portalResult(organizationId: string, examId: string, studentId: string) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const result = await this.portalResultIn(db, organizationId, examId, studentId);
      if (!result) throw new NotFoundException('Exam not found');
      return result;
    });
  }

  private async portalResultIn(db: Db, organizationId: string, examId: string, studentId: string) {
    const exam = await db.exam.findFirst({
      where: { id: examId, organizationId, status: 'LOCKED' },
    });
    if (!exam) return null;
    const ctx = await portalContext(db, organizationId, examId);
    const { rows, sectionRank } = await computeResults(db, ctx);
    const r = rows.find((row) => row.studentId === studentId);
    if (!r) return null;
    return {
      exam: {
        id: ctx.exam.id,
        name: ctx.exam.name,
        examType: ctx.exam.examType.name,
        startsOn: iso(ctx.exam.startsOn),
        endsOn: iso(ctx.exam.endsOn),
      },
      section: sectionLabel(ctx, r.classId),
      subjects: ctx.subjects
        .filter((s) => r.subjectIds.includes(s.subjectId))
        .map((s) => {
          const cell = r.cells.get(s.subjectId);
          return {
            code: s.code,
            name: s.name,
            maxMarks: s.maxMarks,
            passMarks: s.passMarks,
            status: cell?.status ?? null,
            marks: cell?.marks ?? null,
            grade: (r.subjectGrades as Record<string, string>)[s.subjectId] ?? null,
          };
        }),
      total: r.total,
      maxTotal: r.maxTotal,
      percentage: r.percentage,
      result: r.result,
      grade: r.grade,
      gpa: r.gpa,
      sectionRank: sectionRank.get(r.studentId) ?? null,
    };
  }

  // --- helpers -------------------------------------------------------------------------------------

  private async cardsOf(
    db: Db,
    organizationId: string,
    ctx: ExamContext,
    wanted: (p: { studentId: string; classId: string; branchId: string }) => boolean,
  ) {
    const { rows, examRank, sectionRank } = await computeResults(db, ctx);
    const chosen = rows
      .filter(wanted)
      .sort(
        (a, b) =>
          sectionLabel(ctx, a.classId).localeCompare(sectionLabel(ctx, b.classId)) ||
          (a.rollNo ?? '~').localeCompare(b.rollNo ?? '~', undefined, { numeric: true }) ||
          a.fullName.localeCompare(b.fullName),
      );
    if (chosen.length === 0) return [];
    const [settings, branches, year] = await Promise.all([
      this.settingsOf(db, organizationId),
      db.branch.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      db.academicYear.findFirst({ where: { id: ctx.exam.academicYearId } }),
    ]);
    const logo = settings.logoFileId ? await this.readLogo(db, settings.logoFileId) : null;
    const branchName = new Map(branches.map((b) => [b.id, b.name]));
    const gradeKey = ctx.scheme
      ? ctx.scheme.bands.map((b) => `${b.grade} ${b.minPercentage}%+`).join(' · ')
      : null;
    return chosen.map((r) => {
      const subjects = ctx.subjects.filter((s) => r.subjectIds.includes(s.subjectId));
      const data: ReportCardData = {
        organizationName: ctx.organization.name,
        branchName: branchName.get(r.branchId) ?? '',
        title: settings.title,
        headerLine: settings.headerLine,
        footerNote: settings.footerNote,
        signatureLabels: settings.signatureLabels,
        logo,
        exam: {
          name: ctx.exam.name,
          type: ctx.exam.examType.name,
          year: year?.name ?? '',
          dates: `${iso(ctx.exam.startsOn)} to ${iso(ctx.exam.endsOn)}`,
        },
        student: {
          fullName: r.fullName,
          admissionNo: r.admissionNo,
          rollNo: r.rollNo,
          section: sectionLabel(ctx, r.classId),
        },
        subjects: subjects.map((s) => {
          const cell = r.cells.get(s.subjectId);
          const marks = !cell
            ? ''
            : cell.status === 'ABSENT'
              ? 'AB'
              : cell.status === 'EXEMPT'
                ? 'EX'
                : String(cell.marks);
          return {
            name: s.name,
            maxMarks: s.maxMarks,
            passMarks: s.passMarks,
            marks,
            grade: (r.subjectGrades as Record<string, string>)[s.subjectId] ?? null,
            failed:
              cell?.status === 'ABSENT' ||
              (cell?.status === 'PRESENT' && (cell.marks ?? 0) < s.passMarks),
          };
        }),
        total: r.total,
        maxTotal: r.maxTotal,
        percentage: r.percentage,
        result: r.result,
        grade: r.grade,
        gradeRemark: r.gradeRemark,
        gpa: r.gpa,
        sectionRank: sectionRank.get(r.studentId) ?? null,
        examRank: examRank.get(r.studentId) ?? null,
        gradeKey,
      };
      return { branchId: r.branchId, data };
    });
  }

  private async readLogo(db: Db, fileId: string): Promise<Buffer | null> {
    try {
      const { stream } = await this.files.open(db, fileId);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
      return Buffer.concat(chunks);
    } catch {
      return null; // a missing logo file must not stop the cards
    }
  }

  private async settingsOf(db: Db, organizationId: string) {
    const row = await db.reportCardSettings.findUnique({ where: { organizationId } });
    return row
      ? {
          title: row.title,
          headerLine: row.headerLine,
          footerNote: row.footerNote,
          signatureLabels: row.signatureLabels,
          logoFileId: row.logoFileId,
        }
      : { ...DEFAULTS };
  }

  private async getSettingsIn(db: Db, organizationId: string) {
    const { logoFileId, ...rest } = await this.settingsOf(db, organizationId);
    return { ...rest, hasLogo: logoFileId !== null };
  }
}

/**
 * The exam for the portal: no staff permission applies (the portal service checked the link to
 * the student), and only a LOCKED exam is shown.
 */
export async function portalContext(db: Db, organizationId: string, examId: string) {
  const exam = await db.exam.findFirst({ where: { id: examId, organizationId, status: 'LOCKED' } });
  if (!exam) throw new NotFoundException('Exam not found');
  return examContext(db, organizationId, examId, null);
}

const sectionLabel = (ctx: ExamContext, classId: string) =>
  ctx.sections.find((s) => s.id === classId)?.label ?? ctx.tree.label(classId);
const safe = (name: string) => name.replace(/[^\w.\- ()]/g, '_').slice(0, 150);
const fileName = (ctx: ExamContext, card: ReportCardData) =>
  safe(`${ctx.exam.name} ${card.student.admissionNo} report card.pdf`);
const stripUndefined = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
