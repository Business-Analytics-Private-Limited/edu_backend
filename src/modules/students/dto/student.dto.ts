/**
 * Request bodies and filters for the Students module: admission, profile, leaving and
 * re-admission, section and branch changes, guardians, promotion, import, admission numbers and
 * documents (ADR-0020, ADR-0030).
 */
import { AdmissionNumbering, Gender, GuardianRelation, StudentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

const ADMISSION_NO = /^[A-Za-z0-9/_-]+$/;
const ADMISSION_NO_MESSAGE = 'admissionNo may only contain letters, digits, /, _ and -';

// --- Guardians -----------------------------------------------------------------------------------

export class GuardianDto {
  /** Link a guardian who is already on record (e.g. a sibling's parent) instead of a new one. */
  @IsOptional()
  @IsUUID()
  existingGuardianId?: string;

  /** Needed for a new guardian. @example Ramesh Kumar */
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;

  @IsEnum(GuardianRelation)
  relation: GuardianRelation;

  /** @example 9876543210 */
  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  occupation?: string;

  /** The main contact for this student. */
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;

  @IsOptional()
  @IsEnum(GuardianRelation)
  relation?: GuardianRelation;

  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  occupation?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

// --- Enrolments ----------------------------------------------------------------------------------

export class EnrolmentDto {
  /** An academic year of the organization that isn't closed. */
  @IsUUID()
  academicYearId: string;

  /** A section of the student's branch. */
  @IsUUID()
  classId: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  rollNo?: string;
}

export class UpdateEnrolmentDto {
  /** The roll number in the section; null clears it. */
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Length(1, 20)
  rollNo: string | null;
}

// --- Students ------------------------------------------------------------------------------------

export class StudentProfileDto {
  /** As in official records. @example Ravi Teja */
  @IsString()
  @Length(2, 150)
  fullName: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  surname?: string;

  /** @example 2010-05-14 */
  @IsDateString({ strict: true })
  dateOfBirth: string;

  @IsEnum(Gender)
  gender: Gender;

  @IsOptional()
  @IsString()
  @Length(1, 5)
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string;

  /** Lateral entry: where the student studied before. @example Narayana Junior College */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  previousInstitution?: string;

  /** @example 1st year: 845/1000 */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  previousMarks?: string;
}

export class AdmitStudentDto extends StudentProfileDto {
  /** The branch the student will study at. */
  @IsUUID()
  branchId: string;

  /**
   * Required when the organization types admission numbers (MANUAL); ignored when they are
   * AUTOMATIC. Unique in the organization. @example SVJC260001
   */
  @IsOptional()
  @Matches(ADMISSION_NO, { message: ADMISSION_NO_MESSAGE })
  @Length(1, 30)
  admissionNo?: string;

  /** @example 2026-06-01 */
  @IsDateString({ strict: true })
  admissionDate: string;

  /** Place the student in a section of the branch right away (optional). */
  @IsOptional()
  @ValidateNested()
  @Type(() => EnrolmentDto)
  enrolment?: EnrolmentDto;

  /** Parents / guardians (optional, more can be added later). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuardianDto)
  guardians?: GuardianDto[];
}

/** Every profile field optional, for editing. */
export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  surname?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @IsString()
  @Length(1, 5)
  bloodGroup?: string;

  @IsOptional()
  @IsString()
  @Length(6, 20)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  previousInstitution?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  previousMarks?: string;

  /** To correct a mistake. Unique in the organization. */
  @IsOptional()
  @Matches(ADMISSION_NO, { message: ADMISSION_NO_MESSAGE })
  @Length(1, 30)
  admissionNo?: string;
}

/** The student leaves the organization: they become OUTGOING (ADR-0030). */
export class LeaveDto {
  @IsIn(['TRANSFERRED', 'DISCONTINUED', 'COMPLETED'])
  status: 'TRANSFERRED' | 'DISCONTINUED' | 'COMPLETED';

  /** The day they left. @example 2027-04-30 */
  @IsDateString({ strict: true })
  effectiveOn: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;

  /** Where they went, if known. @example Narayana Junior College */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  destination?: string;
}

/** An outgoing student comes back: current again (place them in a section afterwards). */
export class ReadmitDto {
  @IsDateString({ strict: true })
  effectiveOn: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;
}

/** Another section of the same branch, from a date (one student, from the profile). */
export class ChangeSectionDto {
  @IsUUID()
  classId: string;

  /** The first day in the new section. @example 2026-07-15 */
  @IsDateString({ strict: true })
  effectiveOn: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  rollNo?: string;
}

/** Another branch (and a section there), from a date (one student, from the profile). */
export class ChangeBranchDto extends ChangeSectionDto {
  @IsUUID()
  branchId: string;
}

export class ListStudentsQuery extends PaginationQuery {
  /** Part of the name, admission number or phone. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /**
   * Students placed in this class or anything under it, in every branch: a year, group, stream,
   * course ... or one section.
   */
  @IsOptional()
  @IsUUID()
  classId?: string;

  /** Placed in this year (with classId: placed there in this year). */
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  /** current (default) = ACTIVE students; outgoing = those who left; all. */
  @IsOptional()
  @IsIn(['current', 'outgoing', 'all'])
  show?: 'current' | 'outgoing' | 'all';

  /** One exact status, e.g. TRANSFERRED (overrides "show"). */
  @IsOptional()
  @IsEnum(StudentStatus)
  status?: StudentStatus;
}

export class GuardianSearchQuery {
  /** Find guardians already on record by phone, e.g. to link a sibling's parent. */
  @IsString()
  @Length(4, 20)
  phone: string;
}

// --- Promotion -----------------------------------------------------------------------------------

export class PromotionQuery {
  @IsUUID()
  branchId: string;

  /** The year the students are in now. */
  @IsUUID()
  fromYearId: string;

  /** The year they move on to (later, not closed). */
  @IsUUID()
  toYearId: string;
}

export class SectionChoiceDto {
  @IsUUID()
  fromSectionId: string;

  /** Where this section's students go; leave out (and complete false) to skip the section. */
  @IsOptional()
  @IsUUID()
  toSectionId?: string;

  /** true = these students finish: their enrolment completes and they become outgoing. */
  @IsOptional()
  @IsBoolean()
  complete?: boolean;
}

export class ApplyPromotionDto extends PromotionQuery {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SectionChoiceDto)
  mapping: SectionChoiceDto[];

  /** Keep each student's roll number in the new section. */
  @IsOptional()
  @IsBoolean()
  keepRollNumbers?: boolean;
}

export class BranchQuery {
  @IsUUID()
  branchId: string;
}

// --- Admission numbers and import ---------------------------------------------------------------

export class SetNumberingDto {
  @IsEnum(AdmissionNumbering)
  mode: AdmissionNumbering;

  /** For AUTOMATIC, e.g. "{CODE}{YY}{SEQ:4}" or "{CODE}/{BRANCH}/{SEQ:4}". */
  @IsOptional()
  @IsString()
  @Length(0, 40)
  pattern?: string | null;
}

/**
 * One row of an import, as text exactly as in the file. The service checks every field and
 * reports problems by row number, so one bad row doesn't hide the others. Where the students go
 * (branch, year, section) is chosen on the screen, not in the file (ADR-0030).
 */
export class ImportRowDto {
  /** Only with MANUAL admission numbers (ignored with AUTOMATIC). */
  @IsOptional() @IsString() admissionNo?: string;
  @IsOptional() @IsString() admissionDate?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() surname?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() previousInstitution?: string;
  @IsOptional() @IsString() previousMarks?: string;
  @IsOptional() @IsString() rollNo?: string;
  @IsOptional() @IsString() guardianName?: string;
  /** father, mother, guardian or other. */
  @IsOptional() @IsString() guardianRelation?: string;
  @IsOptional() @IsString() guardianPhone?: string;
}

export class ImportStudentsDto {
  /** The academic year the students are placed in (not closed). */
  @IsUUID()
  academicYearId: string;

  /** The section every row goes into; its branch is the students' branch. */
  @IsUUID()
  sectionId: string;

  /** true = only check the rows and report problems; nothing is saved. */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows: ImportRowDto[];
}

// --- Documents -----------------------------------------------------------------------------------

export class CreateDocumentTypeDto {
  /** @example Transfer certificate */
  @IsString()
  @Length(2, 100)
  name: string;

  /** Shown as missing on a student's page until uploaded. */
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  /** Parents and students may see and download it in the portal. */
  @IsOptional()
  @IsBoolean()
  visibleInPortal?: boolean;
}

export class UpdateDocumentTypeDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleInPortal?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UploadDocumentDto {
  /** Sent as a form field next to the file. */
  @IsUUID()
  documentTypeId: string;
}

export class ReviewDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  /** Required when rejecting: why. */
  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}
