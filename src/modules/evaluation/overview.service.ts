/**
 * OVERVIEWS (ADR-0036): how an exam went, by section, group (a "batch": MPC, BiPC ...), branch
 * and for everything the user may see; per subject; the toppers; the weakest subjects; and the
 * grade spread. Plus a year's exams side by side.
 *
 * Who sees what: only the sections at branches where the user has "evaluation.marks.view". An
 * organization-wide user sees the whole exam. Figures come from computeResults, so they agree
 * with the results screen and the report cards.
 *
 * Definitions:
 *   - pass % = passed / (passed + failed); students with marks missing are left out;
 *   - average % = the mean of the students' percentages (complete results only);
 *   - a subject's average % counts ABSENT as 0 and leaves EXEMPT out.
 */
import { Injectable } from '@nestjs/common';
import type { CurrentUser } from '../../common/current-user';
import { can } from '../../common/scope';
import { PrismaService } from '../../prisma/prisma.service';
import { YearOverviewQuery } from './dto/evaluation.dto';
import { examContext, mayView } from './exams.service';
import { average, computeResults, type ExamContext } from './marks.service';

type Row = Awaited<ReturnType<typeof computeResults>>['rows'][number];

@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** One exam, broken down. */
  exam(organizationId: string, examId: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const ctx = await examContext(db, organizationId, examId, actor);
      const { rows, examRank } = await computeResults(db, ctx);
      const visible = visibleRows(ctx, rows, actor);
      const branches = await db.branch.findMany({
        where: { organizationId },
        select: { id: true, name: true },
      });
      const branchName = new Map(branches.map((b) => [b.id, b.name]));
      const groupOf = (classId: string) => {
        const path = ctx.tree.path(classId);
        // The level under the year (a group or a course); a school class has none.
        return path.length > 2 ? path[1] : null;
      };

      const byKey = (keyOf: (r: Row) => { id: string; label: string } | null) => {
        const groups = new Map<string, { label: string; rows: Row[] }>();
        for (const r of visible) {
          const key = keyOf(r);
          if (!key) continue;
          if (!groups.has(key.id)) groups.set(key.id, { label: key.label, rows: [] });
          groups.get(key.id)!.rows.push(r);
        }
        return [...groups.entries()]
          .map(([id, g]) => ({ id, label: g.label, ...summaryOf(g.rows, examRank) }))
          .sort((a, b) => a.label.localeCompare(b.label));
      };

      const subjects = ctx.subjects.map((s) => {
        let sum = 0;
        let counted = 0;
        let passed = 0;
        let highest: number | null = null;
        for (const r of visible) {
          const cell = r.cells.get(s.subjectId);
          if (!cell || cell.status === 'EXEMPT') continue;
          const marks = cell.status === 'ABSENT' ? 0 : (cell.marks ?? 0);
          sum += (marks / s.maxMarks) * 100;
          counted++;
          if (cell.status === 'PRESENT' && marks >= s.passMarks) passed++;
          if (cell.status === 'PRESENT' && (highest === null || marks > highest)) highest = marks;
        }
        return {
          subjectId: s.subjectId,
          code: s.code,
          name: s.name,
          maxMarks: s.maxMarks,
          students: counted,
          averagePercentage: counted ? round(sum / counted) : null,
          passPercentage: counted ? round((passed / counted) * 100) : null,
          highest,
        };
      });

      const gradeSpread = ctx.scheme
        ? ctx.scheme.bands.map((b) => ({
            grade: b.grade,
            students: visible.filter((r) => r.grade === b.grade).length,
          }))
        : null;

      return {
        exam: { id: ctx.exam.id, name: ctx.exam.name, status: ctx.exam.status },
        everything: summaryOf(visible, examRank),
        byBranch: byKey((r) => ({ id: r.branchId, label: branchName.get(r.branchId) ?? '' })),
        byGroup: byKey((r) => {
          const g = groupOf(r.classId);
          return g ? { id: g.id, label: ctx.tree.label(g.id) } : null;
        }),
        bySection: byKey((r) => ({ id: r.classId, label: ctx.tree.label(r.classId) })),
        subjects,
        weakSubjects: [...subjects]
          .filter((s) => s.passPercentage !== null)
          .sort(
            (a, b) =>
              a.passPercentage! - b.passPercentage! || a.averagePercentage! - b.averagePercentage!,
          )
          .slice(0, 3),
        gradeSpread,
      };
    });
  }

  /** A year's exams side by side: students, pass % and average % of what the user may see. */
  year(organizationId: string, query: YearOverviewQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(
      organizationId,
      async (db) => {
        const exams = await db.exam.findMany({
          where: { organizationId, academicYearId: query.academicYearId },
          include: { examType: { select: { name: true, code: true } } },
          orderBy: { startsOn: 'asc' },
        });
        const result = [];
        for (const exam of exams.filter((e) => mayView(actor, e))) {
          const ctx = await examContext(db, organizationId, exam.id, actor);
          const { rows, examRank } = await computeResults(db, ctx);
          const s = summaryOf(visibleRows(ctx, rows, actor), examRank);
          result.push({
            id: exam.id,
            name: exam.name,
            examType: exam.examType,
            startsOn: exam.startsOn.toISOString().slice(0, 10),
            status: exam.status,
            students: s.students,
            passed: s.passed,
            failed: s.failed,
            incomplete: s.incomplete,
            passPercentage: s.passPercentage,
            averagePercentage: s.averagePercentage,
          });
        }
        return result;
      },
      { timeoutMs: 120_000 },
    );
  }
}

/** The rows of the sections the user may see marks of. */
function visibleRows(ctx: ExamContext, rows: Row[], actor: CurrentUser) {
  const allowed = new Set(
    ctx.sections
      .filter((s) => can(actor, 'evaluation.marks.view', { branchId: s.branchId }))
      .map((s) => s.id),
  );
  return rows.filter((r) => allowed.has(r.classId));
}

/** Counts, pass %, average % and the top three of a group of students. */
function summaryOf(rows: Row[], examRank: Map<string, number>) {
  const passed = rows.filter((r) => r.result === 'PASS').length;
  const failed = rows.filter((r) => r.result === 'FAIL').length;
  const complete = rows.filter((r) => r.complete);
  const percentages = complete.map((r) => r.percentage).filter((p): p is number => p !== null);
  const toppers = [...complete]
    .sort((a, b) => b.total - a.total || a.fullName.localeCompare(b.fullName))
    .slice(0, 3)
    .map((r) => ({
      studentId: r.studentId,
      fullName: r.fullName,
      admissionNo: r.admissionNo,
      percentage: r.percentage,
      examRank: examRank.get(r.studentId) ?? null,
    }));
  return {
    students: rows.length,
    passed,
    failed,
    incomplete: rows.length - passed - failed,
    passPercentage: passed + failed > 0 ? round((passed / (passed + failed)) * 100) : null,
    averagePercentage: average(percentages),
    highestPercentage: percentages.length ? Math.max(...percentages) : null,
    toppers,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
