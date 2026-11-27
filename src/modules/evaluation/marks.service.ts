/**
 * MARKS (ADR-0035): a section's grid, saving marks by hand, uploading a CSV per exam, and the
 * results (totals, percentage, pass / fail, ranks).
 *
 * A mark is one student in one subject: PRESENT with marks (0 to the subject's maximum, two
 * decimals at most), ABSENT, or EXEMPT (left out of the totals). It is stored with the student's
 * section and branch during the exam.
 *
 * A student has marks only in the subjects of their section (exam-scope.ts, subjectsBySection),
 * plus any subject they already have a mark in (so a mark entered before a class's subjects
 * changed still shows and still counts).
 *
 * CSV upload ("Check the file" / "Upload marks"):
 *   - columns: admissionNo, then one column per subject code (or name); name / section / roll
 *     columns are ignored; other unknown columns are reported and ignored;
 *   - values: a number; AB or A = absent; EX = exempt; blank or - = leave as it is;
 *   - a row is left out, with its reasons, when the admission number is missing or unknown, the
 *     student isn't in this exam, the number appears twice, the user may not upload marks at the
 *     student's branch, or a value is not understood, above the maximum, or for a subject the
 *     student's section doesn't have;
 *   - the valid rows are saved in one transaction and the upload is recorded (MKS-0001 ...).
 *
 * Permissions, at the student's / section's branch: evaluation.marks.view (grid, results),
 * .enter (save by hand), .import (upload). A LOCKED exam takes no marks.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MarkStatus, Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhere } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SaveMarksDto, UploadMarksDto } from './dto/evaluation.dto';
import { byRoll, participantsOf, type Participant } from './exam-scope';
import { examContext, mayView, type ExamSubjectInfo } from './exams.service';

/** One mark to write. */
interface MarkWrite {
  examSubjectId: string;
  studentId: string;
  classId: string;
  branchId: string;
  status: MarkStatus;
  marks: number | null;
}

/** A row of a CSV upload that was left out, and why. */
export interface ExcludedMarksRow {
  row: number;
  admissionNo: string | null;
  reasons: string[];
  values: Record<string, string>;
}

type Cell = { status: MarkStatus; marks: number | null };

const uploadCode = (n: number) => `MKS-${String(n).padStart(4, '0')}`;
/** "Admission No" -> "admissionno": headings compared without case, spaces or signs. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const ADMISSION_HEADINGS = new Set(['admissionno', 'admissionnumber', 'admno']);
const IGNORED_HEADINGS = new Set([
  'name',
  'fullname',
  'studentname',
  'surname',
  'section',
  'rollno',
  'roll',
  'sno',
  'slno',
]);

/**
 * A CSV value -> a mark: number, AB / A (absent), EX (exempt). Blank = nothing to save (null).
 * Throws a short reason when the value can't be used.
 */
export function readMark(value: string | undefined, subject: ExamSubjectInfo): Cell | null {
  const v = (value ?? '').trim().toUpperCase();
  if (v === '' || v === '-') return null;
  if (v === 'AB' || v === 'A' || v === 'ABSENT') return { status: 'ABSENT', marks: null };
  if (v === 'EX' || v === 'EXEMPT') return { status: 'EXEMPT', marks: null };
  if (!/^\d+(\.\d{1,2})?$/.test(v)) {
    throw new Error(
      `${subject.code} "${value!.trim()}" is not a mark (a number, AB for absent or EX for exempt)`,
    );
  }
  const marks = Number(v);
  if (marks > subject.maxMarks)
    throw new Error(`${subject.code} ${marks} is above the maximum of ${subject.maxMarks}`);
  return { status: 'PRESENT', marks };
}

/**
 * Totals and result of one student. EXEMPT subjects don't count. FAIL: absent, or below the
 * pass marks, in a subject. INCOMPLETE: a subject without a mark (and nothing failed yet).
 */
export function resultOf(subjects: ExamSubjectInfo[], cells: Map<string, Cell>) {
  let total = 0;
  let maxTotal = 0;
  let failed = false;
  let missing = false;
  for (const s of subjects) {
    const cell = cells.get(s.subjectId);
    if (!cell) {
      missing = true;
      maxTotal += s.maxMarks;
      continue;
    }
    if (cell.status === 'EXEMPT') continue;
    maxTotal += s.maxMarks;
    if (cell.status === 'ABSENT') {
      failed = true;
      continue;
    }
    total += cell.marks ?? 0;
    if ((cell.marks ?? 0) < s.passMarks) failed = true;
  }
  const result: 'PASS' | 'FAIL' | 'INCOMPLETE' = failed ? 'FAIL' : missing ? 'INCOMPLETE' : 'PASS';
  const percentage = maxTotal > 0 ? Math.round((total / maxTotal) * 10000) / 100 : null;
  return { total: Math.round(total * 100) / 100, maxTotal, percentage, result, complete: !missing };
}

/** Standard competition ranking (1, 2, 2, 4) by total, among the given complete results. */
export function rank<T extends { studentId: string; total: number }>(
  rows: T[],
): Map<string, number> {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const ranks = new Map<string, number>();
  sorted.forEach((row, i) => {
    const prev = sorted[i - 1];
    ranks.set(row.studentId, prev && prev.total === row.total ? ranks.get(prev.studentId)! : i + 1);
  });
  return ranks;
}

@Injectable()
export class MarksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** A section's grid: its students (roll order) and their marks per subject. */
  grid(organizationId: string, examId: string, sectionId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const ctx = await examContext(db, organizationId, examId, actor);
      const section = this.sectionOf(ctx.sections, sectionId);
      assertCan(actor, 'evaluation.marks.view', { branchId: section.branchId });
      const participants = await participantsOf(
        db,
        ctx.exam,
        ctx.sections.map((s) => s.id),
      );
      const students = [...participants.values()]
        .filter((p) => p.classId === sectionId)
        .sort(byRoll);
      const cells = await this.cellsOf(
        db,
        examId,
        students.map((s) => s.studentId),
        ctx.subjects,
      );
      // The section's subjects, and any other subject a student of it already has a mark in.
      const own = ctx.sectionSubjects.get(sectionId) ?? new Set<string>();
      const withMarks = new Set([...cells.values()].flatMap((c) => [...c.keys()]));
      return {
        exam: { id: ctx.exam.id, name: ctx.exam.name, status: ctx.exam.status },
        section,
        subjects: ctx.subjects.filter((s) => own.has(s.subjectId) || withMarks.has(s.subjectId)),
        canEnter:
          ctx.exam.status === 'OPEN' &&
          can(actor, 'evaluation.marks.enter', { branchId: section.branchId }),
        students: students.map((s) => ({
          studentId: s.studentId,
          admissionNo: s.admissionNo,
          fullName: s.fullName,
          rollNo: s.rollNo,
          marks: Object.fromEntries(cells.get(s.studentId) ?? new Map()),
        })),
      };
    });
  }

  /** Saves a section's marks typed by hand. All or nothing: any problem refuses the save. */
  save(organizationId: string, examId: string, dto: SaveMarksDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const ctx = await examContext(db, organizationId, examId, actor);
      this.assertOpen(ctx.exam);
      const section = this.sectionOf(ctx.sections, dto.sectionId);
      assertCan(actor, 'evaluation.marks.enter', { branchId: section.branchId });
      const participants = await participantsOf(
        db,
        ctx.exam,
        ctx.sections.map((s) => s.id),
      );
      const subjectById = new Map(ctx.subjects.map((s) => [s.subjectId, s]));
      const own = ctx.sectionSubjects.get(section.id) ?? new Set<string>();
      const has = await this.existingMarks(db, examId);

      const problems: string[] = [];
      const writes: MarkWrite[] = [];
      const clears: { examSubjectId: string; studentId: string }[] = [];
      for (const e of dto.entries) {
        const student = participants.get(e.studentId);
        const subject = subjectById.get(e.subjectId);
        if (!student || student.classId !== section.id) {
          problems.push('A student is not in this section for this exam');
          continue;
        }
        if (!subject) {
          problems.push('A subject is not part of this exam');
          continue;
        }
        if (e.status === 'CLEAR') {
          clears.push({ examSubjectId: subject.examSubjectId, studentId: student.studentId });
          continue;
        }
        if (
          !own.has(subject.subjectId) &&
          !has.has(`${subject.examSubjectId}|${student.studentId}`)
        ) {
          problems.push(`${subject.code} is not a subject of ${section.label}`);
          continue;
        }
        if (e.status === 'PRESENT' && (e.marks === undefined || e.marks > subject.maxMarks)) {
          problems.push(
            e.marks === undefined
              ? `${student.fullName}, ${subject.code}: marks are missing`
              : `${student.fullName}, ${subject.code}: ${e.marks} is above the maximum of ${subject.maxMarks}`,
          );
          continue;
        }
        writes.push({
          examSubjectId: subject.examSubjectId,
          studentId: student.studentId,
          classId: student.classId,
          branchId: student.branchId,
          status: e.status,
          marks: e.status === 'PRESENT' ? e.marks! : null,
        });
      }
      if (problems.length > 0) {
        throw new BadRequestException([...new Set(problems)].slice(0, 10).join('; '));
      }
      const saved = await this.writeMarks(db, organizationId, examId, writes, actor);
      for (const c of clears) {
        await db.examMark.deleteMany({
          where: { examSubjectId: c.examSubjectId, studentId: c.studentId },
        });
      }
      await this.audit.log(db, actor, {
        action: 'enter marks',
        entity: 'exam',
        entityId: examId,
        branchId: section.branchId,
        details: { exam: ctx.exam.name, section: section.label, saved, cleared: clears.length },
      });
      return { saved, cleared: clears.length };
    });
  }

  /** "Check the file" (dryRun) or "Upload marks": see the top of this file. */
  upload(organizationId: string, examId: string, dto: UploadMarksDto, actor: CurrentUser) {
    return this.prisma.forOrganization(
      organizationId,
      async (db) => {
        const ctx = await examContext(db, organizationId, examId, actor);
        this.assertOpen(ctx.exam);

        // 1. The columns: admission number, the exam's subjects, ignored and unknown ones.
        const headings = [...new Set(dto.rows.flatMap((r) => Object.keys(r)))];
        const admissionHeading = headings.find((h) => ADMISSION_HEADINGS.has(squash(h)));
        if (!admissionHeading)
          throw new BadRequestException('The file needs an admissionNo column');
        const subjectOf = new Map<string, ExamSubjectInfo>();
        const unknownColumns: string[] = [];
        for (const h of headings) {
          if (h === admissionHeading || IGNORED_HEADINGS.has(squash(h))) continue;
          const subject = ctx.subjects.find(
            (s) => squash(s.code) === squash(h) || squash(s.name) === squash(h),
          );
          if (subject) subjectOf.set(h, subject);
          else unknownColumns.push(h);
        }
        if (subjectOf.size === 0) {
          throw new BadRequestException(
            `No column matches a subject of this exam (expected ${ctx.subjects.map((s) => s.code).join(', ')})`,
          );
        }

        // 2. Each row: who it is, may we, and its values.
        const participants = await participantsOf(
          db,
          ctx.exam,
          ctx.sections.map((s) => s.id),
        );
        const byAdmission = new Map(
          [...participants.values()].map((p) => [p.admissionNo.toUpperCase(), p]),
        );
        const numbers = dto.rows.map((r) => (r[admissionHeading] ?? '').trim()).filter(Boolean);
        const known = new Set(
          (
            await db.student.findMany({
              where: { organizationId, admissionNo: { in: numbers, mode: 'insensitive' } },
              select: { admissionNo: true },
            })
          ).map((s) => s.admissionNo.toUpperCase()),
        );
        const has = await this.existingMarks(db, examId);
        const seen = new Set<string>();
        const excluded: ExcludedMarksRow[] = [];
        const writes: MarkWrite[] = [];
        let readyRows = 0;
        dto.rows.forEach((values, index) => {
          const row = index + 2; // row 1 is the heading
          const admissionNo = (values[admissionHeading] ?? '').trim();
          const reasons: string[] = [];
          const student: Participant | undefined = byAdmission.get(admissionNo.toUpperCase());
          if (!admissionNo) reasons.push('admission number is empty');
          else if (seen.has(admissionNo.toUpperCase()))
            reasons.push('this admission number is already in an earlier row');
          else if (!known.has(admissionNo.toUpperCase()))
            reasons.push(`no student with admission number ${admissionNo}`);
          else if (!student)
            reasons.push(
              'this student is not in this exam (not placed in its sections during the exam)',
            );
          else if (!can(actor, 'evaluation.marks.import', { branchId: student.branchId })) {
            reasons.push("your roles don't allow uploading marks at this student's branch");
          }
          if (admissionNo) seen.add(admissionNo.toUpperCase());
          const cells: MarkWrite[] = [];
          for (const [heading, subject] of subjectOf) {
            try {
              const cell = readMark(values[heading], subject);
              if (
                cell &&
                student &&
                !ctx.sectionSubjects.get(student.classId)?.has(subject.subjectId) &&
                !has.has(`${subject.examSubjectId}|${student.studentId}`)
              ) {
                reasons.push(`${subject.code} is not a subject of this student's section`);
              } else if (cell && student) {
                cells.push({
                  examSubjectId: subject.examSubjectId,
                  studentId: student.studentId,
                  classId: student.classId,
                  branchId: student.branchId,
                  ...cell,
                });
              }
            } catch (error) {
              reasons.push((error as Error).message);
            }
          }
          if (reasons.length === 0 && cells.length === 0) reasons.push('no marks in this row');
          if (reasons.length > 0) {
            excluded.push({ row, admissionNo: admissionNo || null, reasons, values });
            return;
          }
          readyRows++;
          writes.push(...cells);
        });

        const summary = {
          totalRows: dto.rows.length,
          readyRows,
          marksToSave: writes.length,
          excluded,
          subjects: [...subjectOf.values()].map((s) => s.code),
          unknownColumns,
        };
        if (dto.dryRun) return { ...summary, saved: 0, upload: null };

        // 3. Save the valid rows and record the upload.
        const saved = await this.writeMarks(db, organizationId, examId, writes, actor);
        const last = await db.marksUpload.aggregate({
          where: { organizationId },
          _max: { number: true },
        });
        const number = (last._max.number ?? 0) + 1;
        const record = await db.marksUpload.create({
          data: {
            organizationId,
            number,
            examId,
            fileName: dto.fileName ?? null,
            totalRows: dto.rows.length,
            savedCount: readyRows,
            excludedCount: excluded.length,
            excludedRows: excluded as unknown as Prisma.InputJsonValue,
            uploadedBy: actor.id,
          },
        });
        await this.audit.log(db, actor, {
          action: 'upload marks',
          entity: 'exam',
          entityId: examId,
          branchId: ctx.exam.branchId,
          details: {
            exam: ctx.exam.name,
            upload: uploadCode(number),
            rows: readyRows,
            marks: saved,
            excluded: excluded.length,
          },
        });
        return { ...summary, saved, upload: { id: record.id, code: uploadCode(number) } };
      },
      { timeoutMs: 120_000 },
    );
  }

  /** Results: totals, percentage, pass / fail, ranks in the section and the whole exam. */
  results(
    organizationId: string,
    examId: string,
    sectionId: string | undefined,
    actor: CurrentUser,
  ) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const ctx = await examContext(db, organizationId, examId, actor);
      if (sectionId) this.sectionOf(ctx.sections, sectionId);
      const shown = ctx.sections.filter(
        (s) =>
          (!sectionId || s.id === sectionId) &&
          can(actor, 'evaluation.marks.view', { branchId: s.branchId }),
      );
      if (sectionId && shown.length === 0) {
        assertCan(actor, 'evaluation.marks.view', {
          branchId: this.sectionOf(ctx.sections, sectionId).branchId,
        });
      }
      // Ranks are over everyone in the exam, so they are the same whoever looks.
      const participants = [
        ...(
          await participantsOf(
            db,
            ctx.exam,
            ctx.sections.map((s) => s.id),
          )
        ).values(),
      ];
      const cells = await this.cellsOf(
        db,
        examId,
        participants.map((p) => p.studentId),
        ctx.subjects,
      );
      const rows = participants.map((p) => {
        const own = cells.get(p.studentId) ?? new Map<string, Cell>();
        // The student's subjects: their section's, and any they already have a mark in.
        const theirs = ctx.subjects.filter(
          (s) => ctx.sectionSubjects.get(p.classId)?.has(s.subjectId) || own.has(s.subjectId),
        );
        return {
          ...p,
          cells: own,
          subjectIds: theirs.map((s) => s.subjectId),
          ...resultOf(theirs, own),
        };
      });
      const complete = rows.filter((r) => r.complete);
      const examRank = rank(complete);
      const sectionRank = new Map<string, number>();
      for (const s of ctx.sections) {
        for (const [id, r] of rank(complete.filter((c) => c.classId === s.id)))
          sectionRank.set(id, r);
      }
      const shownIds = new Set(shown.map((s) => s.id));
      const label = new Map(ctx.sections.map((s) => [s.id, s.label]));
      const students = rows
        .filter((r) => shownIds.has(r.classId))
        .sort(
          (a, b) =>
            (examRank.get(a.studentId) ?? 1e9) - (examRank.get(b.studentId) ?? 1e9) || byRoll(a, b),
        )
        .map((r) => ({
          studentId: r.studentId,
          admissionNo: r.admissionNo,
          fullName: r.fullName,
          rollNo: r.rollNo,
          section: { id: r.classId, label: label.get(r.classId) ?? '' },
          subjectIds: r.subjectIds,
          marks: Object.fromEntries(r.cells),
          total: r.total,
          maxTotal: r.maxTotal,
          percentage: r.percentage,
          result: r.result,
          sectionRank: sectionRank.get(r.studentId) ?? null,
          examRank: examRank.get(r.studentId) ?? null,
        }));
      const count = (result: string) => students.filter((s) => s.result === result).length;
      return {
        exam: { id: ctx.exam.id, name: ctx.exam.name, status: ctx.exam.status },
        subjects: ctx.subjects,
        sections: shown,
        summary: {
          students: students.length,
          passed: count('PASS'),
          failed: count('FAIL'),
          incomplete: count('INCOMPLETE'),
          averagePercentage: average(
            students.filter((s) => s.result !== 'INCOMPLETE').map((s) => s.percentage),
          ),
        },
        students,
      };
    });
  }

  /** The exam's uploads, newest first. */
  listUploads(organizationId: string, examId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      await examContext(db, organizationId, examId, actor);
      const uploads = await db.marksUpload.findMany({
        where: { examId },
        orderBy: { createdAt: 'desc' },
      });
      return this.withNames(
        db,
        uploads.map(({ excludedRows: _rows, ...u }) => u),
      );
    });
  }

  /** One upload, with the rows left out and why. */
  getUpload(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const upload = await db.marksUpload.findFirst({
        where: { id, organizationId },
        include: { exam: true },
      });
      if (
        !upload ||
        !mayView(actor, upload.exam) ||
        !canSomewhere(actor, 'evaluation.marks.view')
      ) {
        throw new NotFoundException('Upload not found');
      }
      const { exam, ...rest } = upload;
      const [named] = await this.withNames(db, [rest]);
      return { ...named, exam: { id: exam.id, name: exam.name } };
    });
  }

  // --- helpers -----------------------------------------------------------------------------------

  private sectionOf<T extends { id: string }>(sections: T[], sectionId: string): T {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) throw new BadRequestException('That section is not part of this exam');
    return section;
  }

  private assertOpen(exam: { status: string }) {
    if (exam.status !== 'OPEN')
      throw new BadRequestException('The exam is locked: unlock it to change marks');
  }

  /** "examSubjectId|studentId" of every mark of the exam. */
  private async existingMarks(db: Db, examId: string) {
    const marks = await db.examMark.findMany({
      where: { examId },
      select: { examSubjectId: true, studentId: true },
    });
    return new Set(marks.map((m) => `${m.examSubjectId}|${m.studentId}`));
  }

  /** student id -> subject id -> mark. */
  private async cellsOf(db: Db, examId: string, studentIds: string[], subjects: ExamSubjectInfo[]) {
    const subjectOf = new Map(subjects.map((s) => [s.examSubjectId, s.subjectId]));
    const marks = await db.examMark.findMany({ where: { examId, studentId: { in: studentIds } } });
    const cells = new Map<string, Map<string, Cell>>();
    for (const m of marks) {
      const subjectId = subjectOf.get(m.examSubjectId);
      if (!subjectId) continue;
      if (!cells.has(m.studentId)) cells.set(m.studentId, new Map());
      cells
        .get(m.studentId)!
        .set(subjectId, { status: m.status, marks: m.marks === null ? null : Number(m.marks) });
    }
    return cells;
  }

  /**
   * Writes marks: new ones in one go, changed ones one by one, unchanged ones not at all.
   * Returns how many were new or changed.
   */
  private async writeMarks(
    db: Db,
    organizationId: string,
    examId: string,
    writes: MarkWrite[],
    actor: CurrentUser,
  ) {
    if (writes.length === 0) return 0;
    const existing = await db.examMark.findMany({
      where: { examId, studentId: { in: [...new Set(writes.map((w) => w.studentId))] } },
    });
    const key = (examSubjectId: string, studentId: string) => `${examSubjectId}|${studentId}`;
    const current = new Map(existing.map((m) => [key(m.examSubjectId, m.studentId), m]));
    const fresh: Prisma.ExamMarkCreateManyInput[] = [];
    let changed = 0;
    for (const w of writes) {
      const old = current.get(key(w.examSubjectId, w.studentId));
      if (!old) {
        fresh.push({ organizationId, examId, ...w, enteredBy: actor.id });
        continue;
      }
      const same =
        old.status === w.status && (old.marks === null ? null : Number(old.marks)) === w.marks;
      if (same) continue;
      await db.examMark.update({
        where: { id: old.id },
        data: {
          status: w.status,
          marks: w.marks,
          classId: w.classId,
          branchId: w.branchId,
          enteredBy: actor.id,
        },
      });
      changed++;
    }
    if (fresh.length > 0) await db.examMark.createMany({ data: fresh });
    return fresh.length + changed;
  }

  /** Adds the uploader's name and the MKS code. */
  private async withNames<T extends { uploadedBy: string; number: number }>(db: Db, uploads: T[]) {
    const users = await db.user.findMany({
      where: { id: { in: [...new Set(uploads.map((u) => u.uploadedBy))] } },
      select: { id: true, name: true },
    });
    const name = new Map(users.map((u) => [u.id, u.name]));
    return uploads.map((u) => ({
      ...u,
      code: uploadCode(u.number),
      uploadedByName: name.get(u.uploadedBy) ?? '',
    }));
  }
}

function average(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  return nums.length
    ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
    : null;
}
