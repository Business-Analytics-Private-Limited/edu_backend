/**
 * EXAMS (ADR-0035): an exam has a type, an academic year, dates, its subjects with maximum and
 * pass marks, and the part of the structure it is for (a year, group, stream or one section) at
 * one branch or at every branch. See exam-scope.ts for which sections and students take part.
 *
 * Where the permission is needed: an exam for every branch needs it for the whole organization;
 * an exam for one branch, at that branch. Exams for every branch are seen by anyone who may see
 * exams somewhere (their students take part); a branch's exams only by those allowed there.
 *
 * Rules:
 *   - the exam dates lie inside its academic year, and the year is not closed;
 *   - at least one active section takes part;
 *   - a LOCKED exam can't be changed (unlock it first);
 *   - a subject with marks can't be removed, and its maximum can't go below a mark entered;
 *   - an exam with marks can't be deleted (lock it instead).
 *
 * Subjects: the New exam form offers the subjects attached to the chosen part of the structure
 * (subjectOptions). Each section is then expected to have marks only in ITS subjects (see
 * subjectsBySection in exam-scope.ts, with its two fallbacks for half-finished set-ups).
 * Each subject may carry a "portion" note: what the exam covers ("Ch 1-4, Trigonometry").
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ExamStatus, Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan, can, canSomewhere, type Place } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { ClassTree } from '../academic/class-tree';
import { sectionLevel } from '../academic/presets';
import { AuditService } from '../audit/audit.service';
import { assertBranchInUse, findOrganization } from '../organization/places-in-use';
import {
  CreateExamDto,
  ExamsQuery,
  ExamSubjectDto,
  SubjectOptionsQuery,
  UpdateExamDto,
} from './dto/evaluation.dto';
import { participantsOf, sectionsOf, subjectsBySection, type ExamSection } from './exam-scope';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** The place an exam belongs to: its branch, or the whole organization. */
export const placeOfExam = (exam: { branchId: string | null }): Place => ({
  branchId: exam.branchId,
});

/** May the user see this exam at all? */
export function mayView(actor: CurrentUser, exam: { branchId: string | null }): boolean {
  return exam.branchId
    ? can(actor, 'evaluation.exam.view', { branchId: exam.branchId })
    : canSomewhere(actor, 'evaluation.exam.view');
}

/** One subject of an exam, with the subject's code and name. */
export interface ExamSubjectInfo {
  examSubjectId: string;
  subjectId: string;
  code: string;
  name: string;
  maxMarks: number;
  passMarks: number;
  examDate: string | null;
  portion: string | null;
}

/**
 * Everything the marks screens need about an exam: the exam, its subjects (with names), and the
 * sections that take part. Throws 404 when it doesn't exist or the user may not see it.
 */
export async function examContext(db: Db, organizationId: string, id: string, actor: CurrentUser) {
  const exam = await db.exam.findFirst({
    where: { id, organizationId },
    include: { subjects: { orderBy: { sortOrder: 'asc' } }, examType: true },
  });
  if (!exam || !mayView(actor, exam)) throw new NotFoundException('Exam not found');
  const [organization, tree, subjectRows] = await Promise.all([
    findOrganization(db, organizationId),
    ClassTree.load(db, organizationId),
    db.subject.findMany({
      where: { organizationId, id: { in: exam.subjects.map((s) => s.subjectId) } },
    }),
  ]);
  const subjectById = new Map(subjectRows.map((s) => [s.id, s]));
  const subjects: ExamSubjectInfo[] = exam.subjects.map((s) => ({
    examSubjectId: s.id,
    subjectId: s.subjectId,
    code: subjectById.get(s.subjectId)?.code ?? '?',
    name: subjectById.get(s.subjectId)?.name ?? 'Deleted subject',
    maxMarks: Number(s.maxMarks),
    passMarks: Number(s.passMarks),
    examDate: s.examDate ? iso(s.examDate) : null,
    portion: s.portion,
  }));
  const sections = sectionsOf(tree, exam, sectionLevel(organization.type));
  /** Section id -> the subject ids it is expected to have marks in. */
  const sectionSubjects = await subjectsBySection(
    db,
    tree,
    sections,
    subjects.map((s) => s.subjectId),
  );
  return { exam, subjects, sections, sectionSubjects, tree };
}

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** The exams the user may see, newest first. */
  list(organizationId: string, query: ExamsQuery, actor: CurrentUser) {
    if (!canSomewhere(actor, 'evaluation.exam.view')) return Promise.resolve([]);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const exams = await db.exam.findMany({
        where: {
          organizationId,
          academicYearId: query.academicYearId,
          examTypeId: query.examTypeId,
          status: query.status,
          // A branch's list shows its own exams and the exams for every branch.
          ...(query.branchId && { OR: [{ branchId: query.branchId }, { branchId: null }] }),
        },
        include: {
          examType: { select: { name: true, code: true } },
          _count: { select: { subjects: true, marks: true } },
        },
        orderBy: [{ startsOn: 'desc' }, { name: 'asc' }],
      });
      const visible = exams.filter((e) => mayView(actor, e));
      const [tree, years, branches] = await Promise.all([
        ClassTree.load(db, organizationId),
        db.academicYear.findMany({ where: { organizationId }, select: { id: true, name: true } }),
        db.branch.findMany({ where: { organizationId }, select: { id: true, name: true } }),
      ]);
      const yearName = new Map(years.map((y) => [y.id, y.name]));
      const branchName = new Map(branches.map((b) => [b.id, b.name]));
      return visible.map(({ _count, ...e }) => ({
        id: e.id,
        name: e.name,
        examType: e.examType,
        academicYear: { id: e.academicYearId, name: yearName.get(e.academicYearId) ?? '' },
        appliesTo: { classId: e.classId, label: tree.label(e.classId) },
        branch: e.branchId ? { id: e.branchId, name: branchName.get(e.branchId) ?? '' } : null,
        startsOn: iso(e.startsOn),
        endsOn: iso(e.endsOn),
        status: e.status,
        subjectCount: _count.subjects,
        marksEntered: _count.marks,
      }));
    });
  }

  /** One exam: subjects, and per section the students and how many marks are in. */
  get(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const { exam, subjects, sections, sectionSubjects, tree } = await examContext(
        db,
        organizationId,
        id,
        actor,
      );
      const [year, branch, participants, entered, uploads] = await Promise.all([
        db.academicYear.findFirst({ where: { id: exam.academicYearId } }),
        exam.branchId ? db.branch.findFirst({ where: { id: exam.branchId } }) : null,
        participantsOf(
          db,
          exam,
          sections.map((s) => s.id),
        ),
        db.examMark.groupBy({ by: ['classId'], where: { examId: id }, _count: true }),
        db.marksUpload.count({ where: { examId: id } }),
      ]);
      const branches = await db.branch.findMany({
        where: { id: { in: [...new Set(sections.map((s) => s.branchId))] } },
        select: { id: true, name: true },
      });
      const branchName = new Map(branches.map((b) => [b.id, b.name]));
      const studentsIn = new Map<string, number>();
      for (const p of participants.values())
        studentsIn.set(p.classId, (studentsIn.get(p.classId) ?? 0) + 1);
      const enteredIn = new Map(entered.map((e) => [e.classId, e._count]));
      return {
        id: exam.id,
        name: exam.name,
        examType: { id: exam.examType.id, name: exam.examType.name, code: exam.examType.code },
        academicYear: { id: exam.academicYearId, name: year?.name ?? '' },
        appliesTo: { classId: exam.classId, label: tree.label(exam.classId) },
        branch: branch ? { id: branch.id, name: branch.name } : null,
        startsOn: iso(exam.startsOn),
        endsOn: iso(exam.endsOn),
        status: exam.status,
        subjects,
        sections: sections
          .map((s) => {
            const students = studentsIn.get(s.id) ?? 0;
            const subjectIds = [...(sectionSubjects.get(s.id) ?? [])];
            return {
              ...s,
              branchName: branchName.get(s.branchId) ?? '',
              subjectIds,
              students,
              marksExpected: students * subjectIds.length,
              marksEntered: enteredIn.get(s.id) ?? 0,
              canEnter:
                exam.status === 'OPEN' &&
                can(actor, 'evaluation.marks.enter', { branchId: s.branchId }),
            };
          })
          // By branch, then section.
          .sort(
            (a, b) => a.branchName.localeCompare(b.branchName) || a.label.localeCompare(b.label),
          ),
        uploadCount: uploads,
      };
    });
  }

  /**
   * For the New exam form: the subjects of the chosen part of the structure. A subject is listed
   * with how many of the exam's sections have it and where it is attached ("Junior › BiPC"), so
   * an exam for a whole year shows each group's subjects. The organization's other active
   * subjects come separately, for a subject that isn't attached to a class.
   */
  subjectOptions(organizationId: string, query: SubjectOptionsQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const tree = await ClassTree.load(db, organizationId);
      const node = tree.get(query.classId);
      if (!node) throw new NotFoundException('That part of the structure was not found');
      const branchId = node.branchId ?? query.branchId ?? null;
      assertCan(actor, 'evaluation.exam.create', { branchId });
      const organization = await findOrganization(db, organizationId);
      const sections = sectionsOf(
        tree,
        { classId: query.classId, branchId },
        sectionLevel(organization.type),
      );
      const [subjects, links] = await Promise.all([
        db.subject.findMany({
          where: { organizationId, isActive: true },
          orderBy: { name: 'asc' },
        }),
        db.classSubject.findMany({
          where: { organizationId },
          select: { classId: true, subjectId: true },
        }),
      ]);
      // subject id -> the sections that have it, and the classes it is attached to.
      const inSections = new Map<string, Set<string>>();
      const attachedTo = new Map<string, Set<string>>();
      let withoutSubjects = 0;
      for (const section of sections) {
        const pathIds = new Set(tree.path(section.id).map((c) => c.id));
        if (!links.some((l) => pathIds.has(l.classId))) withoutSubjects++;
        for (const l of links) {
          if (!pathIds.has(l.classId)) continue;
          if (!inSections.has(l.subjectId)) inSections.set(l.subjectId, new Set());
          if (!attachedTo.has(l.subjectId)) attachedTo.set(l.subjectId, new Set());
          inSections.get(l.subjectId)!.add(section.id);
          attachedTo.get(l.subjectId)!.add(l.classId);
        }
      }
      const brief = (s: { id: string; code: string; name: string }) => ({
        id: s.id,
        code: s.code,
        name: s.name,
      });
      return {
        appliesTo: { classId: node.id, label: tree.label(node.id) },
        sections: sections.length,
        /** Sections with no subjects attached yet: they take every subject of the exam. */
        sectionsWithoutSubjects: withoutSubjects,
        subjects: subjects
          .filter((s) => inSections.has(s.id))
          .map((s) => ({
            ...brief(s),
            sections: inSections.get(s.id)!.size,
            attachedTo: [...attachedTo.get(s.id)!].map((id) => tree.label(id)).sort(),
          })),
        otherSubjects: subjects.filter((s) => !inSections.has(s.id)).map(brief),
      };
    });
  }

  create(organizationId: string, dto: CreateExamDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const tree = await ClassTree.load(db, organizationId);
      const node = tree.get(dto.classId);
      if (!node || !node.isActive)
        throw new BadRequestException('That part of the structure was not found');
      // An exam for one section belongs to that section's branch.
      const branchId = node.branchId ?? dto.branchId ?? null;
      if (node.branchId && dto.branchId && dto.branchId !== node.branchId) {
        throw new BadRequestException('That section belongs to another branch');
      }
      const place: Place = { branchId };
      assertCan(actor, 'evaluation.exam.create', place);
      if (branchId) await assertBranchInUse(db, branchId);
      await this.checkType(db, organizationId, dto.examTypeId);
      const year = await this.checkDates(
        db,
        organizationId,
        dto.academicYearId,
        dto.startsOn,
        dto.endsOn,
      );
      const organization = await findOrganization(db, organizationId);
      const sections = sectionsOf(
        tree,
        { classId: dto.classId, branchId },
        sectionLevel(organization.type),
      );
      if (sections.length === 0) {
        throw new BadRequestException(
          `There are no active sections under ${tree.label(dto.classId)}${branchId ? ' at this branch' : ''}`,
        );
      }
      await this.checkSubjects(db, organizationId, dto.subjects, dto.startsOn, dto.endsOn);

      const exam = await db.exam.create({
        data: {
          organizationId,
          examTypeId: dto.examTypeId,
          academicYearId: dto.academicYearId,
          name: dto.name.trim(),
          classId: dto.classId,
          branchId,
          startsOn: day(dto.startsOn),
          endsOn: day(dto.endsOn),
          createdBy: actor.id,
          subjects: { create: this.subjectRows(organizationId, dto.subjects) },
        },
      });
      await this.audit.log(db, actor, {
        action: 'create',
        entity: 'exam',
        entityId: exam.id,
        branchId,
        details: {
          name: exam.name,
          year: year.name,
          appliesTo: tree.label(dto.classId),
          subjects: dto.subjects.length,
        },
      });
      return { id: exam.id, name: exam.name, sections: sections.length };
    });
  }

  update(organizationId: string, id: string, dto: UpdateExamDto, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const { exam } = await examContext(db, organizationId, id, actor);
      assertCan(actor, 'evaluation.exam.update', placeOfExam(exam));
      if (exam.status === 'LOCKED')
        throw new BadRequestException('The exam is locked: unlock it first');
      if (dto.examTypeId) await this.checkType(db, organizationId, dto.examTypeId);
      if (dto.startsOn || dto.endsOn) {
        await this.checkDates(
          db,
          organizationId,
          exam.academicYearId,
          dto.startsOn ?? iso(exam.startsOn),
          dto.endsOn ?? iso(exam.endsOn),
        );
      }
      if (dto.subjects) {
        await this.replaceSubjects(db, organizationId, exam, dto.subjects, {
          startsOn: dto.startsOn ?? iso(exam.startsOn),
          endsOn: dto.endsOn ?? iso(exam.endsOn),
        });
      } else if (dto.startsOn || dto.endsOn) {
        // New dates: the subjects' own dates must still lie inside them.
        const startsOn = dto.startsOn ?? iso(exam.startsOn);
        const endsOn = dto.endsOn ?? iso(exam.endsOn);
        const outside = exam.subjects.find(
          (s) => s.examDate && (iso(s.examDate) < startsOn || iso(s.examDate) > endsOn),
        );
        if (outside) {
          throw new BadRequestException(
            `A subject's date (${iso(outside.examDate!)}) is outside the new exam dates`,
          );
        }
      }
      await db.exam.update({
        where: { id },
        data: {
          examTypeId: dto.examTypeId,
          name: dto.name?.trim(),
          startsOn: dto.startsOn ? day(dto.startsOn) : undefined,
          endsOn: dto.endsOn ? day(dto.endsOn) : undefined,
        },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'exam',
        entityId: id,
        branchId: exam.branchId,
        details: { ...dto, subjects: dto.subjects?.length } as Prisma.InputJsonValue,
      });
      return { id, updated: true };
    });
  }

  delete(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const { exam } = await examContext(db, organizationId, id, actor);
      assertCan(actor, 'evaluation.exam.delete', placeOfExam(exam));
      const marks = await db.examMark.count({ where: { examId: id } });
      if (marks > 0) {
        throw new BadRequestException(
          `${marks} mark(s) are entered for this exam: lock it instead of deleting it`,
        );
      }
      await db.exam.delete({ where: { id } });
      await this.audit.log(db, actor, {
        action: 'delete',
        entity: 'exam',
        entityId: id,
        branchId: exam.branchId,
        details: { name: exam.name },
      });
      return { deleted: true };
    });
  }

  /** Lock (no more marks) or unlock an exam. */
  setStatus(organizationId: string, id: string, status: ExamStatus, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const { exam } = await examContext(db, organizationId, id, actor);
      assertCan(actor, 'evaluation.exam.update', placeOfExam(exam));
      if (exam.status === status) return { id, status };
      await db.exam.update({ where: { id }, data: { status } });
      await this.audit.log(db, actor, {
        action: status === 'LOCKED' ? 'lock' : 'unlock',
        entity: 'exam',
        entityId: id,
        branchId: exam.branchId,
        details: { name: exam.name },
      });
      return { id, status };
    });
  }

  // --- checks ------------------------------------------------------------------------------------

  private async checkType(db: Db, organizationId: string, examTypeId: string) {
    const type = await db.examType.findFirst({ where: { id: examTypeId, organizationId } });
    if (!type) throw new BadRequestException('Exam type not found');
    if (!type.isActive)
      throw new BadRequestException(`The exam type "${type.name}" is switched off`);
  }

  /** The year exists, isn't closed, and holds the dates. */
  private async checkDates(
    db: Db,
    organizationId: string,
    yearId: string,
    startsOn: string,
    endsOn: string,
  ) {
    const year = await db.academicYear.findFirst({ where: { id: yearId, organizationId } });
    if (!year) throw new BadRequestException('Academic year not found');
    if (year.status === 'CLOSED')
      throw new BadRequestException(`The academic year ${year.name} is closed`);
    if (startsOn > endsOn) throw new BadRequestException('The exam ends before it starts');
    if (startsOn < iso(year.startsOn) || endsOn > iso(year.endsOn)) {
      throw new BadRequestException(
        `The exam dates must be inside ${year.name} (${iso(year.startsOn)} to ${iso(year.endsOn)})`,
      );
    }
    return year;
  }

  /**
   * Each subject once, existing and active, with pass marks not above the maximum, and its date
   * (if any) inside the exam's dates.
   */
  private async checkSubjects(
    db: Db,
    organizationId: string,
    subjects: ExamSubjectDto[],
    startsOn: string,
    endsOn: string,
  ) {
    const ids = subjects.map((s) => s.subjectId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A subject appears twice');
    const found = await db.subject.findMany({ where: { organizationId, id: { in: ids } } });
    if (found.length !== ids.length) throw new BadRequestException('A subject was not found');
    const off = found.filter((s) => !s.isActive);
    if (off.length > 0)
      throw new BadRequestException(`Switched-off subject: ${off.map((s) => s.name).join(', ')}`);
    const byId = new Map(found.map((s) => [s.id, s]));
    for (const s of subjects) {
      if (s.passMarks > s.maxMarks) {
        throw new BadRequestException(
          `${byId.get(s.subjectId)!.name}: pass marks are above the maximum marks`,
        );
      }
      if (s.examDate && (s.examDate < startsOn || s.examDate > endsOn)) {
        throw new BadRequestException(
          `${byId.get(s.subjectId)!.name}: the date ${s.examDate} is outside the exam (${startsOn} to ${endsOn})`,
        );
      }
    }
  }

  private subjectRows(organizationId: string, subjects: ExamSubjectDto[]) {
    return subjects.map((s, index) => ({
      organizationId,
      subjectId: s.subjectId,
      maxMarks: s.maxMarks,
      passMarks: s.passMarks,
      examDate: s.examDate ? day(s.examDate) : null,
      portion: s.portion?.trim() || null,
      sortOrder: index,
    }));
  }

  /**
   * The new subject list: kept subjects get their new marks and order; new ones are added; a
   * removed subject must have no marks; a maximum can't go below a mark already entered.
   */
  private async replaceSubjects(
    db: Db,
    organizationId: string,
    exam: { id: string; subjects: { id: string; subjectId: string }[] },
    subjects: ExamSubjectDto[],
    dates: { startsOn: string; endsOn: string },
  ) {
    await this.checkSubjects(db, organizationId, subjects, dates.startsOn, dates.endsOn);
    const wanted = new Map(subjects.map((s, i) => [s.subjectId, { ...s, sortOrder: i }]));
    for (const current of exam.subjects) {
      const next = wanted.get(current.subjectId);
      const highest = await db.examMark.aggregate({
        where: { examSubjectId: current.id },
        _max: { marks: true },
        _count: true,
      });
      if (!next) {
        if (highest._count > 0)
          throw new BadRequestException("A subject with marks entered can't be removed");
        await db.examSubject.delete({ where: { id: current.id } });
        continue;
      }
      if (highest._max.marks !== null && Number(highest._max.marks) > next.maxMarks) {
        throw new BadRequestException(
          `A mark of ${Number(highest._max.marks)} is already entered: the maximum can't be ${next.maxMarks}`,
        );
      }
      await db.examSubject.update({
        where: { id: current.id },
        data: {
          maxMarks: next.maxMarks,
          passMarks: next.passMarks,
          examDate: next.examDate ? day(next.examDate) : null,
          portion: next.portion?.trim() || null,
          sortOrder: next.sortOrder,
        },
      });
      wanted.delete(current.subjectId);
    }
    if (wanted.size > 0) {
      await db.examSubject.createMany({
        data: [...wanted.values()].map((s) => ({
          organizationId,
          examId: exam.id,
          subjectId: s.subjectId,
          maxMarks: s.maxMarks,
          passMarks: s.passMarks,
          examDate: s.examDate ? day(s.examDate) : null,
          portion: s.portion?.trim() || null,
          sortOrder: s.sortOrder,
        })),
      });
    }
  }
}

export type { ExamSection };
