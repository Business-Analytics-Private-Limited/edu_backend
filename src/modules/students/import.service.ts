/**
 * IMPORTING STUDENTS from a spreadsheet (CSV), and the admission-number setting (ADR-0030).
 *
 * Import: on the screen the user chooses WHERE the students go, step by step: branch, academic
 * year, then the structure level by level (e.g. Junior > MPC > JEE Mains), then the section. The
 * sheet only has the students' own columns; every row goes into that section. This service
 *   1. checks EVERY row and reports all problems with their row numbers (row 2 = the first row
 *      under the header, as in Excel);
 *   2. with dryRun (or if any row has a problem) saves nothing;
 *   3. otherwise admits all rows at once, in one transaction: all or nothing.
 * Columns: admissionNo (only with MANUAL numbering), admissionDate, fullName, surname,
 * dateOfBirth, gender, phone, email, address, previousInstitution, previousMarks, rollNo,
 * guardianName, guardianRelation, guardianPhone. Dates as 2026-06-01 or 01/06/2026.
 * Needs "students.student.import" and "students.student.create" at the section's branch.
 *
 * Admission numbers: the organization admin chooses AUTOMATIC (from a pattern) or MANUAL
 * ("students.settings.update" for the whole organization).
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Gender, GuardianRelation } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { ClassTree } from '../academic/class-tree';
import { AuditService } from '../audit/audit.service';
import { findOrganization } from '../organization/places-in-use';
import { admissionNumberFor, checkPattern, render } from './admission-numbers';
import { ImportRowDto, ImportStudentsDto, SetNumberingDto } from './dto/student.dto';
import { checkPlacement } from './placement';

const GENDERS: Record<string, Gender> = {
  M: 'MALE',
  MALE: 'MALE',
  BOY: 'MALE',
  F: 'FEMALE',
  FEMALE: 'FEMALE',
  GIRL: 'FEMALE',
  OTHER: 'OTHER',
  O: 'OTHER',
};
const RELATIONS: Record<string, GuardianRelation> = {
  FATHER: 'FATHER',
  MOTHER: 'MOTHER',
  GUARDIAN: 'GUARDIAN',
  OTHER: 'OTHER',
};

/** "2026-06-01", "01/06/2026" or "01-06-2026" -> Date; null if not a real date. */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const v = value.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v;
  const dmy = v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) iso = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (!iso) return null;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? null : date;
}

const clean = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

/** A row after checking: what will be saved. */
interface ReadyRow {
  row: number;
  admissionNo?: string;
  admissionDate: Date;
  fullName: string;
  surname?: string;
  dateOfBirth: Date;
  gender: Gender;
  phone?: string;
  email?: string;
  address?: string;
  previousInstitution?: string;
  previousMarks?: string;
  rollNo?: string;
  guardian?: { fullName: string; relation: GuardianRelation; phone?: string };
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

        const { ready, errors } = await this.check(db, organization, section.id, year.id, dto);
        if (errors.length > 0 || dto.dryRun) {
          return { ok: errors.length === 0, total: dto.rows.length, imported: 0, errors };
        }

        for (const r of ready) {
          const admissionNo = await admissionNumberFor(
            db,
            { ...organization, organizationId },
            branch,
            r.admissionDate,
            r.admissionNo,
          );
          const student = await db.student.create({
            data: {
              organizationId,
              branchId: branch.id,
              admissionNo,
              admissionDate: r.admissionDate,
              fullName: r.fullName,
              surname: r.surname,
              dateOfBirth: r.dateOfBirth,
              gender: r.gender,
              phone: r.phone,
              email: r.email,
              address: r.address,
              previousInstitution: r.previousInstitution,
              previousMarks: r.previousMarks,
              statusChanges: {
                create: {
                  organizationId,
                  toStatus: 'ACTIVE',
                  effectiveOn: r.admissionDate,
                  reason: 'Admission (import)',
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
                  enrolledOn: r.admissionDate > year.startsOn ? r.admissionDate : year.startsOn,
                  reason: 'Admission (import)',
                },
              },
            },
          });
          if (r.guardian) {
            const guardian = await db.guardian.create({
              data: { organizationId, fullName: r.guardian.fullName, phone: r.guardian.phone },
            });
            await db.studentGuardian.create({
              data: {
                organizationId,
                studentId: student.id,
                guardianId: guardian.id,
                relation: r.guardian.relation,
                isPrimary: true,
              },
            });
          }
        }
        const tree = await ClassTree.load(db, organizationId);
        await this.audit.log(db, actor, {
          action: 'import',
          entity: 'students',
          ...place,
          details: { imported: ready.length, year: year.name, section: tree.label(section.id) },
        });
        return { ok: true, total: dto.rows.length, imported: ready.length, errors: [] };
      },
      { timeoutMs: 120_000 },
    );
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
  ): Promise<{ ready: ReadyRow[]; errors: { row: number; message: string }[] }> {
    const errors: { row: number; message: string }[] = [];
    const ready: ReadyRow[] = [];
    const manual = organization.admissionNumbering === 'MANUAL';

    const existingNos = new Set(
      manual
        ? (
            await db.student.findMany({
              where: {
                organizationId: organization.id,
                admissionNo: {
                  in: dto.rows.map((r) => clean(r.admissionNo)).filter((v): v is string => !!v),
                },
              },
              select: { admissionNo: true },
            })
          ).map((s) => s.admissionNo)
        : [],
    );
    const takenRolls = new Set(
      (
        await db.enrolment.findMany({
          where: { academicYearId, classId: sectionId, status: 'ACTIVE', rollNo: { not: null } },
          select: { rollNo: true },
        })
      ).map((e) => e.rollNo!),
    );
    const seenNos = new Set<string>();

    dto.rows.forEach((raw: ImportRowDto, index) => {
      const row = index + 2; // as in the spreadsheet: row 1 is the header
      const problems: string[] = [];
      const admissionNo = manual ? clean(raw.admissionNo) : undefined;
      const admissionDate = parseDate(raw.admissionDate);
      const dateOfBirth = parseDate(raw.dateOfBirth);
      const fullName = clean(raw.fullName);
      const gender = GENDERS[(raw.gender ?? '').trim().toUpperCase()];

      if (!fullName) problems.push('fullName is empty');
      if (!admissionDate) {
        problems.push('admissionDate is missing or not a date (2026-06-01 or 01/06/2026)');
      }
      if (!dateOfBirth) problems.push('dateOfBirth is missing or not a date');
      if (!gender) problems.push('gender must be male, female or other');
      if (manual) {
        if (!admissionNo) {
          problems.push('admissionNo is empty (this organization types admission numbers)');
        } else {
          if (!/^[A-Za-z0-9/_-]{1,30}$/.test(admissionNo)) {
            problems.push('admissionNo has characters that are not allowed');
          }
          if (existingNos.has(admissionNo)) {
            problems.push(`admission number ${admissionNo} is already used`);
          }
          if (seenNos.has(admissionNo)) {
            problems.push(`admission number ${admissionNo} appears twice in the file`);
          }
          seenNos.add(admissionNo);
        }
      }

      const rollNo = clean(raw.rollNo);
      if (rollNo) {
        if (takenRolls.has(rollNo)) {
          problems.push(`roll number ${rollNo} is already used in this section`);
        }
        takenRolls.add(rollNo);
      }

      const guardianName = clean(raw.guardianName);
      const relation = RELATIONS[(clean(raw.guardianRelation) ?? 'GUARDIAN').toUpperCase()];
      if (guardianName && !relation) {
        problems.push('guardianRelation must be father, mother, guardian or other');
      }

      if (problems.length > 0) {
        errors.push(...problems.map((message) => ({ row, message })));
        return;
      }
      ready.push({
        row,
        admissionNo,
        admissionDate: admissionDate!,
        fullName: fullName!,
        surname: clean(raw.surname),
        dateOfBirth: dateOfBirth!,
        gender,
        phone: clean(raw.phone),
        email: clean(raw.email),
        address: clean(raw.address),
        previousInstitution: clean(raw.previousInstitution),
        previousMarks: clean(raw.previousMarks),
        rollNo,
        guardian: guardianName
          ? { fullName: guardianName, relation: relation!, phone: clean(raw.guardianPhone) }
          : undefined,
      });
    });
    return { ready, errors };
  }
}
