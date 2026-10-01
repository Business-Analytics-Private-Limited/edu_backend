/**
 * IMPORTING STUDENTS from a spreadsheet (CSV), and the admission-number setting.
 *
 * Import: the screen reads the file and sends its rows; this service
 *   1. checks EVERY row and reports all problems with their row numbers (row 2 = the first row
 *      under the header, as in Excel);
 *   2. with dryRun (or if any row has a problem) saves nothing;
 *   3. otherwise admits all rows at once, in one transaction: all or nothing.
 * Columns: admissionNo, admissionDate, fullName, surname, dateOfBirth, gender, phone, email,
 * address, batch (code), section (class codes from the top, e.g. "Y1/MPC/A"), rollNo,
 * guardianName, guardianRelation, guardianPhone. Dates as 2026-06-01 or 01/06/2026.
 * Needs "students.student.import" at the campus.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import type { Gender, GuardianRelation } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import { assertCan } from '../../common/scope';
import { Db, PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { checkPattern, nextAdmissionNo, render } from './admission-numbers';
import { ImportRowDto, ImportStudentsDto } from './dto/student.dto';
import { findCampus } from './placement';

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
  batchId?: string;
  sectionId?: string;
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
        const campus = await findCampus(db, organizationId, dto.campusId);
        const place = { institutionId: campus.institutionId, campusId: campus.id };
        assertCan(actor, 'students.student.import', place);
        assertCan(actor, 'students.student.create', place);

        const { ready, errors } = await this.check(db, campus, dto);
        if (errors.length > 0 || dto.dryRun) {
          return { ok: errors.length === 0, total: dto.rows.length, imported: 0, errors };
        }

        const institution = await db.institution.findUniqueOrThrow({
          where: { id: campus.institutionId },
        });
        for (const r of ready) {
          const admissionNo =
            r.admissionNo ?? (await nextAdmissionNo(db, institution, r.admissionDate));
          const student = await db.student.create({
            data: {
              organizationId,
              institutionId: campus.institutionId,
              campusId: campus.id,
              admissionNo,
              admissionDate: r.admissionDate,
              fullName: r.fullName,
              surname: r.surname,
              dateOfBirth: r.dateOfBirth,
              gender: r.gender,
              phone: r.phone,
              email: r.email,
              address: r.address,
              batchId: r.batchId,
              statusChanges: {
                create: {
                  organizationId,
                  toStatus: 'ACTIVE',
                  effectiveOn: r.admissionDate,
                  reason: 'Admission (import)',
                  changedBy: actor.id,
                },
              },
              ...(r.sectionId && {
                enrolments: {
                  create: {
                    organizationId,
                    institutionId: campus.institutionId,
                    campusId: campus.id,
                    academicYearId: dto.academicYearId!,
                    classId: r.sectionId,
                    rollNo: r.rollNo,
                    enrolledOn: r.admissionDate,
                  },
                },
              }),
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
        await this.audit.log(db, actor, {
          action: 'import',
          entity: 'students',
          ...place,
          details: { imported: ready.length },
        });
        return { ok: true, total: dto.rows.length, imported: ready.length, errors: [] };
      },
      { timeoutMs: 120_000 },
    );
  }

  /** The admission-number pattern of an institution ("students.settings.update" there). */
  setNumbering(
    organizationId: string,
    institutionId: string,
    pattern: string | null | undefined,
    actor: CurrentUser,
  ) {
    const place = { institutionId };
    assertCan(actor, 'students.settings.update', place);
    const value = pattern?.trim() ? pattern.trim() : null;
    if (value) checkPattern(value);
    return this.prisma.forOrganization(organizationId, async (db) => {
      const institution = await db.institution.findFirst({
        where: { id: institutionId, organizationId },
      });
      if (!institution) throw new BadRequestException('Institution not found');
      await db.institution.update({
        where: { id: institutionId },
        data: { admissionNoPattern: value },
      });
      await this.audit.log(db, actor, {
        action: 'update',
        entity: 'admission_numbering',
        entityId: institutionId,
        ...place,
        details: { before: institution.admissionNoPattern, after: value },
      });
      return {
        pattern: value,
        example: value ? render(value, institution.code, new Date().getUTCFullYear(), 1) : null,
      };
    });
  }

  // --- Checking the rows -----------------------------------------------------------------------

  private async check(
    db: Db,
    campus: { id: string; institutionId: string },
    dto: ImportStudentsDto,
  ): Promise<{ ready: ReadyRow[]; errors: { row: number; message: string }[] }> {
    const errors: { row: number; message: string }[] = [];
    const ready: ReadyRow[] = [];

    // What the rows refer to, loaded once.
    const [institution, batches, classes, levelCount, year] = await Promise.all([
      db.institution.findUniqueOrThrow({ where: { id: campus.institutionId } }),
      db.batch.findMany({ where: { institutionId: campus.institutionId } }),
      db.class.findMany({ where: { campusId: campus.id } }),
      db.classLevel.count({ where: { institutionId: campus.institutionId } }),
      dto.academicYearId
        ? db.academicYear.findFirst({
            where: { id: dto.academicYearId, institutionId: campus.institutionId },
          })
        : Promise.resolve(null),
    ]);
    if (dto.academicYearId && (!year || year.status === 'CLOSED')) {
      errors.push({
        row: 0,
        message: "The academic year must be one of the institution's years and not closed",
      });
    }
    const batchByCode = new Map(batches.map((b) => [b.code.toUpperCase(), b.id]));
    const sectionByPath = new Map<string, string>();
    const byId = new Map(classes.map((c) => [c.id, c]));
    const pathOf = (id: string): string[] => {
      const c = byId.get(id)!;
      return [...(c.parentId ? pathOf(c.parentId) : []), c.code.toUpperCase()];
    };
    for (const c of classes) {
      if (c.level === levelCount && c.isActive) sectionByPath.set(pathOf(c.id).join('/'), c.id);
    }
    const existingNos = new Set(
      (
        await db.student.findMany({
          where: {
            institutionId: campus.institutionId,
            admissionNo: {
              in: dto.rows.map((r) => clean(r.admissionNo)).filter((v): v is string => !!v),
            },
          },
          select: { admissionNo: true },
        })
      ).map((s) => s.admissionNo),
    );
    const takenRolls = new Set(
      year
        ? (
            await db.enrolment.findMany({
              where: { academicYearId: year.id, campusId: campus.id, rollNo: { not: null } },
              select: { classId: true, rollNo: true },
            })
          ).map((e) => `${e.classId}#${e.rollNo}`)
        : [],
    );
    const seenNos = new Set<string>();

    dto.rows.forEach((raw: ImportRowDto, index) => {
      const row = index + 2; // as in the spreadsheet: row 1 is the header
      const problems: string[] = [];
      const admissionNo = clean(raw.admissionNo);
      const admissionDate = parseDate(raw.admissionDate);
      const dateOfBirth = parseDate(raw.dateOfBirth);
      const fullName = clean(raw.fullName);
      const gender = GENDERS[(raw.gender ?? '').trim().toUpperCase()];

      if (!fullName) problems.push('fullName is empty');
      if (!admissionDate)
        problems.push('admissionDate is missing or not a date (2026-06-01 or 01/06/2026)');
      if (!dateOfBirth) problems.push('dateOfBirth is missing or not a date');
      if (!gender) problems.push('gender must be male, female or other');
      if (admissionNo) {
        if (!/^[A-Za-z0-9/_-]{1,30}$/.test(admissionNo))
          problems.push('admissionNo has characters that are not allowed');
        if (existingNos.has(admissionNo))
          problems.push(`admission number ${admissionNo} is already used`);
        if (seenNos.has(admissionNo))
          problems.push(`admission number ${admissionNo} appears twice in the file`);
        seenNos.add(admissionNo);
      } else if (!institution.admissionNoPattern) {
        problems.push('admissionNo is empty and the institution has no automatic numbering');
      }

      const batchCode = clean(raw.batch)?.toUpperCase();
      const batchId = batchCode ? batchByCode.get(batchCode) : undefined;
      if (batchCode && !batchId) problems.push(`no batch with code ${raw.batch}`);

      const sectionPath = clean(raw.section)
        ?.toUpperCase()
        .replace(/\s*[/>›]\s*/g, '/');
      const sectionId = sectionPath ? sectionByPath.get(sectionPath) : undefined;
      if (sectionPath) {
        if (!sectionId)
          problems.push(
            `no section ${raw.section} on this campus (use class codes, e.g. Y1/MPC/A)`,
          );
        if (!dto.academicYearId)
          problems.push('choose the academic year to place students in sections');
      }
      const rollNo = clean(raw.rollNo);
      if (rollNo && sectionId) {
        const key = `${sectionId}#${rollNo}`;
        if (takenRolls.has(key))
          problems.push(`roll number ${rollNo} is already used in that section`);
        takenRolls.add(key);
      }

      const guardianName = clean(raw.guardianName);
      const relationText = (clean(raw.guardianRelation) ?? 'GUARDIAN').toUpperCase();
      const relation = RELATIONS[relationText];
      if (guardianName && !relation)
        problems.push('guardianRelation must be father, mother, guardian or other');

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
        batchId,
        sectionId,
        rollNo,
        guardian: guardianName
          ? { fullName: guardianName, relation: relation!, phone: clean(raw.guardianPhone) }
          : undefined,
      });
    });
    return { ready, errors };
  }
}
