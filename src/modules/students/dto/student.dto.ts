/**
 * Request bodies and filters for the Students module: admission, profile, status, guardians,
 * enrolments.
 */
import { Gender, GuardianRelation, StudentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

const ADMISSION_NO = /^[A-Za-z0-9/_-]+$/;

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
  /** The academic year (of the student's institution, not closed). */
  @IsUUID()
  academicYearId: string;

  /** A section: a class of the LAST level, on the student's campus. */
  @IsUUID()
  classId: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  rollNo?: string;
}

export class UpdateEnrolmentDto {
  /** Move to another section (same campus, same year). Needs "students.enrolment.transfer". */
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  rollNo?: string;
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

  /** The batch the student joins (Academic module), of the same institution. */
  @IsOptional()
  @IsUUID()
  batchId?: string;
}

export class AdmitStudentDto extends StudentProfileDto {
  /** The campus the student will study at. */
  @IsUUID()
  campusId: string;

  /** Unique in the institution. @example SVJC260001 */
  @Matches(ADMISSION_NO, { message: 'admissionNo may only contain letters, digits, /, _ and -' })
  @Length(1, 30)
  admissionNo: string;

  /** @example 2026-06-01 */
  @IsDateString({ strict: true })
  admissionDate: string;

  /** Place the student in a section for an academic year right away (optional). */
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
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @Matches(ADMISSION_NO, { message: 'admissionNo may only contain letters, digits, /, _ and -' })
  @Length(1, 30)
  admissionNo?: string;
}

export class ChangeStatusDto {
  @IsEnum(StudentStatus)
  status: StudentStatus;

  /** @example 2027-03-31 */
  @IsDateString({ strict: true })
  effectiveOn: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;
}

export class ListStudentsQuery extends PaginationQuery {
  /** Part of the name, admission number or phone. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  /** Students enrolled in this class (any level: includes the sections below it). */
  @IsOptional()
  @IsUUID()
  classId?: string;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;

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

// --- Promotion and shuffle -----------------------------------------------------------------------

export class PromotionQuery {
  @IsUUID()
  campusId: string;

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

  /** Where this section's students go; leave out (and graduate false) to skip the section. */
  @IsOptional()
  @IsUUID()
  toSectionId?: string;

  /** true = these students finish: their enrolment completes and they become alumni. */
  @IsOptional()
  @IsBoolean()
  graduate?: boolean;
}

export class ApplyPromotionDto extends PromotionQuery {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SectionChoiceDto)
  mapping: SectionChoiceDto[];

  /** Move the promoted students' batches to this stage, e.g. "Senior". */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  batchStage?: string;

  /** Keep each student's roll number in the new section. */
  @IsOptional()
  @IsBoolean()
  keepRollNumbers?: boolean;
}

export class MoveStudentsDto {
  @IsUUID()
  academicYearId: string;

  @IsArray()
  @IsUUID('all', { each: true })
  studentIds: string[];

  /** A section on the same campus. */
  @IsUUID()
  toSectionId: string;
}
