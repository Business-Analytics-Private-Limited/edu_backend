/**
 * IMPORTING STUDENTS from a spreadsheet (CSV), import records, and the admission-number setting
 * (ADR-0030, ADR-0031).
 *
 * Import: on the screen the user chooses WHERE the students go, step by step: branch, academic
 * year, then the structure level by level (e.g. Junior > MPC > JEE Mains), then the section. The
 * sheet only has the students' own columns (IMPORT_COLUMNS); every row goes into that section.
 *
 *   1. every row is turned into values ("BC-A" -> BC_A, "yes" -> true, 01/06/2026 -> a date) and
 *      checked with THE SAME RULES as the admission form (StudentDetailsDto, student-rules.ts);
 *   2. a row is EXCLUDED, with its reasons, when it breaks a rule, or when it would be a
 *      duplicate: an admission number or Aadhaar already used (or twice in the sheet), a roll
 *      number taken in the section, or the same name + date of birth (+ phone) as a student on
 *      record or an earlier row;
 *   3. dryRun ("Check the file"): nothing is saved; the answer lists what would be imported and
 *      what excluded;
 *   4. otherwise ("Import students") the VALID rows are saved, in one transaction, and an IMPORT
 *      RECORD (IMP-0001 ...) keeps who, when, where, the counts and the excluded rows with their
 *      reasons. The file itself is not kept, and an import can't be undone: a wrong student is
 *      corrected on their own page.
 *
 * Needs "students.student.import" and "students.student.create" at the section's branch.
 * Admission numbers: the organization admin chooses AUTOMATIC (from a pattern) or MANUAL
 * ("students.settings.update" for the whole organization).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsOptional,
  ValidateNested,
  validateSync,
  type ValidationError,
} from 'class-validator';
import type { CurrentUser } from '../../common/current-user';
import { paginated, toSkipTake } from '../../common/pagination';
import { assertCan, can, reachOf } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { ClassTree } from '../academic/class-tree';
import { AuditService } from '../audit/audit.service';
import { findOrganization } from '../organization/places-in-use';
import { admissionNumberFor, checkPattern, render } from './admission-numbers';
import {
  GuardianDto,
  IMPORT_COLUMNS,
  ImportRowDto,
  ImportRunsQuery,
  ImportStudentsDto,
  SENSITIVE_FIELDS,
  SetNumberingDto,
  StudentDetailsDto,
} from './dto/student.dto';
import { GuardiansService } from './guardians.service';
import { checkPlacement } from './placement';
import {
  BOARD_WORDS,
  CATEGORY_WORDS,
  checkStudentRules,
  cleanPhone,
  GENDER_WORDS,
  LEARNER_WORDS,
  maskAadhaar,
  RESIDENCE_WORDS,
  squash,
  YES_NO_WORDS,
} from './student-rules';

/** A sheet row as the admission form would send it: checked with the same rules. */
class ImportedStudentDto extends StudentDetailsDto {
  @IsDateString({ strict: true }, { message: 'admissionDate must be a date' })
  admissionDate: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuardianDto)
  guardians?: GuardianDto[];
}

/** A row that passed every check: what will be saved. */
interface ReadyRow {
  row: number;
  details: ImportedStudentDto;
  admissionNo?: string;
  rollNo?: string;
}

/** A row that was left out, and why. `values` = the row as written (for a fix-and-retry sheet). */
export interface ExcludedRow {
  row: number;
  admissionNo: string | null;
  fullName: string | null;
  reasons: string[];
  values: Record<string, string>;
}

const clean = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);
const runCode = (number: number) => `IMP-${String(number).padStart(4, '0')}`;
/** "Ravi  Kumar " -> "ravi kumar", to compare names. */
const sameName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

/** "2026-06-01", "01/06/2026" or "01-06-2026" -> "2026-06-01"; null if not a real date. */
function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v;
  const dmy = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * Every message of a class-validator result, nested ones (guardians) included, except for the
 * fields in `skip` (their value was already reported as not understood, e.g. a bad date).
 */
function messages(errors: ValidationError[], skip: Set<string>): string[] {
  return errors
    .filter((e) => !skip.has(e.property))
    .flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...messages(e.children ?? [], new Set()),
    ]);
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guardians: GuardiansService,
  ) {}

  importStudents(organizationId: string, dto: ImportStudentsDto, actor: CurrentUser) {
    // Up to 2000 rows: allow the transaction two minutes instead of the usual 5 seconds.
    return this.prisma.forOrganization(
      organizationId,
      async (db) => {
        const section = await db.class.findFirst({
          where: { id: dto.sectionId, organizationId },
          include: { branch: true },
        });
        if (!section?.branch) throw new BadRequestException('Choose a section');
        const branch = section.branch;
        const place = { branchId: branch.id };
        assertCan(actor, 'students.student.import', place);
        assertCan(actor, 'students.student.create', place);
        const { year } = await checkPlacement(db, organizationId, branch.id, {
          academicYearId: dto.academicYearId,
          classId: section.id,
        });
        const organization = await findOrganization(db, organizationId);

        const { ready, excluded } = await this.check(db, organization, section.id, year.id, dto);
        const answer = {
          dryRun: !!dto.dryRun,
          total: dto.rows.length,
          importable: ready.length,
          excludedCount: excluded.length,
          // Without "students.sensitive.view", sensitive values aren't sent back.
          excluded: excluded.map((e) => this.showExcluded(e, actor, place)),
        };
        if (dto.dryRun || ready.length === 0) return { ...answer, imported: 0, run: null };

        // One import at a time per organization, so IMP numbers never clash.
        await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'import_runs:' + organizationId}))`;
        const last = await db.importRun.findFirst({
          where: { organizationId },
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        const run = await db.importRun.create({
          data: {
            organizationId,
            number: (last?.number ?? 0) + 1,
            branchId: branch.id,
            academicYearId: year.id,
            sectionId: section.id,
            fileName: dto.fileName,
            totalRows: dto.rows.length,
            importedCount: ready.length,
            excludedCount: excluded.length,
            excludedRows: excluded as unknown as Prisma.InputJsonValue,
            importedBy: actor.id,
          },
        });

        for (const r of ready) {
          const { admissionDate: admittedOn, guardians, ...details } = r.details;
          const admissionDate = new Date(admittedOn);
          const admissionNo = await admissionNumberFor(
            db,
            { ...organization, organizationId },
            branch,
            admissionDate,
            r.admissionNo,
          );
          const student = await db.student.create({
            data: {
              ...details,
              organizationId,
              branchId: branch.id,
              admissionNo,
              admissionDate,
              dateOfBirth: new Date(details.dateOfBirth),
              importRunId: run.id,
              importRow: r.row,
              statusChanges: {
                create: {
                  organizationId,
                  toStatus: 'ACTIVE',
                  effectiveOn: admissionDate,
                  reason: `Admission (import ${runCode(run.number)})`,
                  changedBy: actor.id,
                },
              },
              enrolments: {
                create: {
                  organizationId,
                  branchId: branch.id,
                  academicYearId: year.id,
                  classId: section.id,
                  rollNo: r.rollNo,
                  enrolledOn: admissionDate > year.startsOn ? admissionDate : year.startsOn,
                  reason: `Admission (import ${runCode(run.number)})`,
                },
              },
            },
          });
          for (const guardian of guardians ?? []) {
            await this.guardians.link(db, organizationId, student.id, guardian);
          }
        }
        const tree = await ClassTree.load(db, organizationId);
        await this.audit.log(db, actor, {
          action: 'import',
          entity: 'students',
          entityId: run.id,
          ...place,
          details: {
            import: runCode(run.number),
            imported: ready.length,
            excluded: excluded.length,
            year: year.name,
            section: tree.label(section.id),
          },
        });
        return {
          ...answer,
          imported: ready.length,
          run: { id: run.id, code: runCode(run.number) },
        };
      },
      { timeoutMs: 120_000 },
    );
  }

  /** The imports the user may see (where they may import), newest first. */
  listRuns(organizationId: string, query: ImportRunsQuery, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const reach = reachOf(actor, 'students.student.import');
      const where: Prisma.ImportRunWhereInput = {
        organizationId,
        ...(!reach.everywhere && { branchId: { in: reach.branchIds } }),
        ...(query.branchId && { branchId: query.branchId }),
      };
      const [runs, total, tree] = await Promise.all([
        db.importRun.findMany({
          where,
          orderBy: { number: 'desc' },
          omit: { excludedRows: true },
          ...toSkipTake(query),
        }),
        db.importRun.count({ where }),
        ClassTree.load(db, organizationId),
      ]);
      const names = await this.namesFor(db, runs);
      return paginated(
        runs.map((run) => ({
          ...run,
          code: runCode(run.number),
          section: tree.label(run.sectionId),
          ...names(run),
        })),
        total,
        query,
      );
    });
  }

  /**
   * One import: where, who, the counts, the excluded rows with their reasons, and the students
   * it admitted with the details they are still missing (e.g. no phone, no parent).
   */
  getRun(organizationId: string, id: string, actor: CurrentUser) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const run = await db.importRun.findFirst({ where: { id, organizationId } });
      if (!run) throw new NotFoundException('Import not found');
      const place = { branchId: run.branchId };
      assertCan(actor, 'students.student.import', place);
      const [tree, students, names] = await Promise.all([
        ClassTree.load(db, organizationId),
        db.student.findMany({
          where: { importRunId: run.id },
          orderBy: { importRow: 'asc' },
          select: {
            id: true,
            admissionNo: true,
            fullName: true,
            importRow: true,
            status: true,
            phone: true,
            address: true,
            aadhaar: true,
            email: true,
            _count: { select: { guardians: true } },
          },
        }),
        this.namesFor(db, [run]),
      ]);
      return {
        ...run,
        code: runCode(run.number),
        section: tree.label(run.sectionId),
        ...names(run),
        excludedRows: (run.excludedRows as unknown as ExcludedRow[]).map((e) =>
          this.showExcluded(e, actor, place),
        ),
        students: students.map(({ _count, phone, address, aadhaar, email, ...s }) => ({
          ...s,
          missing: [
            !phone && 'phone',
            !email && 'email',
            !address && 'address',
            !aadhaar && 'aadhaar',
            _count.guardians === 0 && 'parent / guardian',
          ].filter((m): m is string => !!m),
        })),
      };
    });
  }

  /** AUTOMATIC (with a pattern) or MANUAL admission numbers, for the whole organization. */
  setNumbering(organizationId: string, dto: SetNumberingDto, actor: CurrentUser) {
    assertCan(actor, 'students.settings.update', {});
    const pattern = dto.pattern?.trim() ? dto.pattern.trim() : null;
    if (dto.mode === 'AUTOMATIC') {
      if (!pattern) throw new BadRequestException('Automatic numbers need a pattern');
      checkPattern(pattern);
    }
    return this.prisma.forOrganization(organizationId, async (db) => {
      const before = await findOrganization(db, organizationId);
      const organization = await db.organization.update({
        where: { id: organizationId },
        data: { admissionNumbering: dto.mode, admissionNoPattern: pattern },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'admission_numbering',
        entityId: organizationId,
        details: {
          before: { mode: before.admissionNumbering, pattern: before.admissionNoPattern },
          after: { mode: dto.mode, pattern },
        },
      });
      return {
        mode: organization.admissionNumbering,
        pattern,
        example: pattern
          ? render(
              pattern,
              { code: organization.code, branch: 'BRANCH', year: new Date().getUTCFullYear() },
              1,
            )
          : null,
      };
    });
  }

  // --- Checking the rows -----------------------------------------------------------------------

  private async check(
    db: Db,
    organization: { id: string; admissionNumbering: 'AUTOMATIC' | 'MANUAL' },
    sectionId: string,
    academicYearId: string,
    dto: ImportStudentsDto,
  ): Promise<{ ready: ReadyRow[]; excluded: ExcludedRow[] }> {
    const manual = organization.admissionNumbering === 'MANUAL';
    const organizationId = organization.id;

    // What is already on record, to find duplicates.
    const typedNos = dto.rows.map((r) => clean(r.admissionNo)).filter((v): v is string => !!v);
    const aadhaars = dto.rows
      .map((r) => clean(r.aadhaar)?.replace(/[\s-]/g, ''))
      .filter((v): v is string => !!v);
    const births = [
      ...new Set(dto.rows.map((r) => parseDate(r.dateOfBirth)).filter((v): v is string => !!v)),
    ];
    const [usedNos, usedAadhaars, sameBirthdays, takenRolls] = await Promise.all([
      manual && typedNos.length
        ? db.student.findMany({
            where: { organizationId, admissionNo: { in: typedNos } },
            select: { admissionNo: true },
          })
        : [],
      aadhaars.length
        ? db.student.findMany({
            where: { organizationId, aadhaar: { in: aadhaars } },
            select: { aadhaar: true, admissionNo: true },
          })
        : [],
      births.length
        ? db.student.findMany({
            where: { organizationId, dateOfBirth: { in: births.map((b) => new Date(b)) } },
            select: {
              admissionNo: true,
              fullName: true,
              dateOfBirth: true,
              phone: true,
              alternatePhone: true,
              guardians: { select: { guardian: { select: { phone: true } } } },
            },
          })
        : [],
      db.enrolment.findMany({
        where: { academicYearId, classId: sectionId, status: 'ACTIVE', rollNo: { not: null } },
        select: { rollNo: true },
      }),
    ]);
    const usedNoSet = new Set(usedNos.map((s) => s.admissionNo));
    const aadhaarOwner = new Map(usedAadhaars.map((s) => [s.aadhaar!, s.admissionNo]));
    const takenRollSet = new Set(takenRolls.map((e) => e.rollNo!));
    // People on record (and earlier rows): name + date of birth -> their phones.
    const people: { key: string; phones: Set<string>; label: string }[] = sameBirthdays.map(
      (s) => ({
        key: `${sameName(s.fullName)}|${s.dateOfBirth.toISOString().slice(0, 10)}`,
        phones: new Set(
          [s.phone, s.alternatePhone, ...s.guardians.map((g) => g.guardian.phone)].filter(
            (p): p is string => !!p,
          ),
        ),
        label: `student ${s.admissionNo}`,
      }),
    );
    const seenNos = new Map<string, number>();
    const seenAadhaars = new Map<string, number>();
    const seenRolls = new Map<string, number>();

    const ready: ReadyRow[] = [];
    const excluded: ExcludedRow[] = [];
    dto.rows.forEach((raw, index) => {
      const row = index + 2; // as in the spreadsheet: row 1 is the header
      const { candidate, problems } = this.toCandidate(raw);
      const details = plainToInstance(ImportedStudentDto, candidate);
      // A field whose word or date wasn't understood is reported once, not again by its rule.
      const reported = new Set(problems.map((p) => p.split(/[\s"]/, 1)[0]));
      problems.push(...messages(validateSync(details), reported));
      problems.push(...checkStudentRules(details));

      // Admission numbers
      const admissionNo = manual ? clean(raw.admissionNo) : undefined;
      if (manual) {
        if (!admissionNo) {
          problems.push('admissionNo is empty (this organization types admission numbers)');
        } else {
          if (!/^[A-Za-z0-9/_-]{1,30}$/.test(admissionNo)) {
            problems.push('admissionNo may only contain letters, digits, /, _ and - (30 at most)');
          }
          if (usedNoSet.has(admissionNo)) {
            problems.push(`admission number ${admissionNo} is already used`);
          }
          const earlier = seenNos.get(admissionNo);
          if (earlier) problems.push(`admission number ${admissionNo} is also in row ${earlier}`);
          else seenNos.set(admissionNo, row);
        }
      }

      // Aadhaar
      const aadhaar = typeof details.aadhaar === 'string' ? details.aadhaar : undefined;
      if (aadhaar) {
        const owner = aadhaarOwner.get(aadhaar);
        if (owner) problems.push(`this Aadhaar number is already used by student ${owner}`);
        const earlier = seenAadhaars.get(aadhaar);
        if (earlier) problems.push(`this Aadhaar number is also in row ${earlier}`);
        else seenAadhaars.set(aadhaar, row);
      }

      // Roll number
      const rollNo = clean(raw.rollNo);
      if (rollNo) {
        if (rollNo.length > 20) problems.push('rollNo must be at most 20 characters');
        if (takenRollSet.has(rollNo)) {
          problems.push(`roll number ${rollNo} is already used in this section`);
        }
        const earlier = seenRolls.get(rollNo);
        if (earlier) problems.push(`roll number ${rollNo} is also in row ${earlier}`);
        else seenRolls.set(rollNo, row);
      }

      // The same person again: same name and date of birth, and a phone in common (or no
      // phones to tell them apart).
      if (details.fullName && candidate.dateOfBirth) {
        const key = `${sameName(details.fullName)}|${candidate.dateOfBirth}`;
        const phones = new Set(
          [
            details.phone,
            details.alternatePhone,
            ...(details.guardians ?? []).map((g) => g.phone),
          ].filter((p): p is string => typeof p === 'string' && p !== ''),
        );
        const twin = people.find(
          (p) =>
            p.key === key &&
            (p.phones.size === 0 || phones.size === 0 || [...phones].some((x) => p.phones.has(x))),
        );
        if (twin) problems.push(`the same student (name, date of birth, phone) as ${twin.label}`);
        people.push({ key, phones, label: `row ${row}` });
      }

      if (problems.length > 0) {
        excluded.push({
          row,
          admissionNo: admissionNo ?? null,
          fullName: clean(raw.fullName) ?? null,
          reasons: [...new Set(problems)],
          values: Object.fromEntries(
            IMPORT_COLUMNS.map((c) => [c, clean(raw[c])]).filter(([, v]) => v !== undefined),
          ) as Record<string, string>,
        });
        return;
      }
      ready.push({ row, details, admissionNo, rollNo });
    });
    return { ready, excluded };
  }

  /**
   * A sheet row -> the values the admission form would send. Words that aren't understood are
   * problems here; everything else is checked by the DTO rules afterwards.
   */
  private toCandidate(raw: ImportRowDto): {
    candidate: Record<string, unknown>;
    problems: string[];
  } {
    const problems: string[] = [];
    const candidate: Record<string, unknown> = {};
    const text = (field: keyof ImportRowDto) => {
      const value = clean(raw[field]);
      if (value !== undefined) candidate[field] = value;
    };
    const word = <T>(field: keyof ImportRowDto, words: Record<string, T>, allowed: string) => {
      const value = clean(raw[field]);
      if (value === undefined) return;
      const found = words[squash(value)];
      if (found === undefined) problems.push(`${field} "${value}" is not one of: ${allowed}`);
      else candidate[field] = found;
    };
    const date = (field: 'admissionDate' | 'dateOfBirth') => {
      const value = clean(raw[field]);
      if (value === undefined) return problems.push(`${field} is empty`);
      const iso = parseDate(value);
      if (!iso) problems.push(`${field} "${value}" is not a date (2026-06-01 or 01/06/2026)`);
      else candidate[field] = iso;
    };
    const number = (field: 'previousPercentage' | 'admissionTestMarks') => {
      const value = clean(raw[field]);
      if (value === undefined) return;
      const n = Number(value.replace(/%$/, ''));
      if (!/^\d+(\.\d+)?%?$/.test(value) || Number.isNaN(n)) {
        problems.push(`${field} "${value}" is not a number`);
      } else candidate[field] = n;
    };

    for (const field of [
      'fullName',
      'surname',
      'phone',
      'alternatePhone',
      'email',
      'address',
      'permanentAddress',
      'area',
      'aadhaar',
      'subCaste',
      'pickupPoint',
      'previousInstitution',
      'hallTicketNo',
      'previousGrade',
      'admissionTestNo',
      'medicalCondition',
      'remarks',
    ] as const) {
      text(field);
    }
    if (!candidate.fullName) problems.push('fullName is empty');
    date('admissionDate');
    date('dateOfBirth');
    const gender = clean(raw.gender);
    if (!gender) problems.push('gender is empty');
    else word('gender', GENDER_WORDS, 'male, female, other (or M / F)');
    const blood = clean(raw.bloodGroup);
    if (blood) candidate.bloodGroup = blood.toUpperCase().replace(/\s+/g, '').replace(/VE$/, '');
    word('category', CATEGORY_WORDS, 'OC, BC-A … BC-E, SC, ST, EWS, Other');
    word('residence', RESIDENCE_WORDS, 'Day scholar, Hosteller');
    word('busFacility', YES_NO_WORDS, 'yes, no');
    word('previousBoard', BOARD_WORDS, 'SSC, CBSE, ICSE, Intermediate, IB, Other');
    word('topRanker', YES_NO_WORDS, 'yes, no (or active, inactive)');
    word('learnerLevel', LEARNER_WORDS, 'Expert, Medium, Slow');
    number('previousPercentage');
    number('admissionTestMarks');

    // Parents: father, mother and guardian columns; the first one given is the main contact.
    const guardians: Record<string, unknown>[] = [];
    for (const [prefix, relation] of [
      ['father', 'FATHER'],
      ['mother', 'MOTHER'],
      ['guardian', 'GUARDIAN'],
    ] as const) {
      const name = clean(raw[`${prefix}Name`]);
      const phone = clean(raw[`${prefix}Phone`]);
      const occupation = clean(raw[`${prefix}Occupation`]);
      if (!name) {
        if (phone || occupation)
          problems.push(`${prefix}Phone / ${prefix}Occupation need ${prefix}Name`);
        continue;
      }
      guardians.push({
        fullName: name,
        relation,
        ...(phone && { phone: cleanPhone(phone) }),
        ...(occupation && { occupation }),
        isPrimary: guardians.length === 0,
      });
    }
    if (guardians.length) candidate.guardians = guardians;
    return { candidate, problems };
  }

  /** An excluded row as shown to this user: sensitive values only with the permission. */
  private showExcluded(row: ExcludedRow, actor: CurrentUser, place: { branchId: string }) {
    if (can(actor, 'students.sensitive.view', place)) return row;
    const values = { ...row.values };
    for (const field of SENSITIVE_FIELDS) {
      if (field in values) values[field] = field === 'aadhaar' ? maskAadhaar(values[field])! : '';
    }
    return { ...row, values };
  }

  /** Branch, year and importer names for import records. */
  private async namesFor(
    db: Db,
    runs: { branchId: string; academicYearId: string; importedBy: string }[],
  ) {
    const [branches, years, users] = await Promise.all([
      db.branch.findMany({
        where: { id: { in: runs.map((r) => r.branchId) } },
        select: { id: true, name: true },
      }),
      db.academicYear.findMany({
        where: { id: { in: runs.map((r) => r.academicYearId) } },
        select: { id: true, name: true },
      }),
      db.user.findMany({
        where: { id: { in: runs.map((r) => r.importedBy) } },
        select: { id: true, name: true },
      }),
    ]);
    const name = (list: { id: string; name: string }[], id: string) =>
      list.find((x) => x.id === id)?.name ?? null;
    return (run: { branchId: string; academicYearId: string; importedBy: string }) => ({
      branchName: name(branches, run.branchId),
      academicYearName: name(years, run.academicYearId),
      importedByName: name(users, run.importedBy),
    });
  }
}
