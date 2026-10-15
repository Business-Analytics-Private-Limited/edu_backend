/**
 * Request bodies and filters for the Students module: admission, profile, leaving and
 * re-admission, section and branch changes, guardians, promotion, import, admission numbers and
 * documents (ADR-0020, ADR-0030).
 */
import { OmitType, PartialType } from '@nestjs/swagger';
import {
  AdmissionNumbering,
  Gender,
  GuardianRelation,
  LearnerLevel,
  PreviousBoard,
  ReservationCategory,
  Residence,
  StudentStatus,
} from '@prisma/client';
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
  IsNumber,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';
import {
  BLOOD_GROUPS,
  CleanAadhaar,
  CleanPhone,
  CODE,
  CODE_MESSAGE,
  IsAadhaar,
  NAME,
  NAME_MESSAGE,
  PHONE,
  PHONE_MESSAGE,
} from '../student-rules';

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
  @Length(2, 100, { message: 'the parent / guardian name must be 2 to 100 characters' })
  @Matches(NAME, { message: NAME_MESSAGE('the parent / guardian name') })
  fullName?: string;

  @IsEnum(GuardianRelation)
  relation: GuardianRelation;

  /** 10-digit mobile. @example 9876543210 */
  @IsOptional()
  @CleanPhone()
  @Matches(PHONE, { message: PHONE_MESSAGE("the parent / guardian's phone") })
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  @Length(2, 50, { message: 'occupation must be 2 to 50 characters' })
  occupation?: string;

  /** The main contact for this student. */
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @Length(2, 100, { message: 'the parent / guardian name must be 2 to 100 characters' })
  @Matches(NAME, { message: NAME_MESSAGE('the parent / guardian name') })
  fullName?: string;

  @IsOptional()
  @IsEnum(GuardianRelation)
  relation?: GuardianRelation;

  @IsOptional()
  @CleanPhone()
  @Matches(PHONE, { message: PHONE_MESSAGE("the parent / guardian's phone") })
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  @Length(2, 50, { message: 'occupation must be 2 to 50 characters' })
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

/**
 * A student's own details (ADR-0031): every rule of every field. Admission extends it, editing
 * makes everything optional, and the import checks each sheet row with it. Only fullName,
 * dateOfBirth and gender are required. Fields marked SENSITIVE are shown only with
 * "students.sensitive.view".
 */
export class StudentDetailsDto {
  /** As in official records. @example K. Ravi Teja */
  @IsString()
  @Length(2, 100, { message: 'fullName must be 2 to 100 characters' })
  @Matches(NAME, { message: NAME_MESSAGE('fullName') })
  fullName: string;

  @IsOptional()
  @IsString()
  @Length(1, 50, { message: 'surname must be at most 50 characters' })
  @Matches(NAME, { message: NAME_MESSAGE('surname') })
  surname?: string | null;

  /** @example 2010-05-14 */
  @IsDateString({ strict: true }, { message: 'dateOfBirth must be a date (YYYY-MM-DD)' })
  dateOfBirth: string;

  @IsEnum(Gender, { message: 'gender must be MALE, FEMALE, OTHER or UNDISCLOSED' })
  gender: Gender;

  @IsOptional()
  @IsIn(BLOOD_GROUPS, { message: `bloodGroup must be one of ${BLOOD_GROUPS.join(', ')}` })
  bloodGroup?: string | null;

  // Contact

  /** 10-digit mobile; "+91 98765-43210" is accepted and cleaned. @example 9876543210 */
  @IsOptional()
  @CleanPhone()
  @Matches(PHONE, { message: PHONE_MESSAGE('phone') })
  phone?: string | null;

  @IsOptional()
  @CleanPhone()
  @Matches(PHONE, { message: PHONE_MESSAGE('alternatePhone') })
  alternatePhone?: string | null;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Length(3, 100, { message: 'email must be at most 100 characters' })
  email?: string | null;

  @IsOptional()
  @IsString()
  @Length(3, 300, { message: 'address must be 3 to 300 characters' })
  address?: string | null;

  @IsOptional()
  @IsString()
  @Length(3, 300, { message: 'permanentAddress must be 3 to 300 characters' })
  permanentAddress?: string | null;

  /** @example Gajuwaka */
  @IsOptional()
  @IsString()
  @Length(2, 50, { message: 'area must be 2 to 50 characters' })
  area?: string | null;

  // Identity and category (SENSITIVE)

  /** SENSITIVE. 12 digits with a valid check digit; spaces are removed. @example 234567890124 */
  @IsOptional()
  @CleanAadhaar()
  @IsAadhaar()
  aadhaar?: string | null;

  /** SENSITIVE. */
  @IsOptional()
  @IsEnum(ReservationCategory, {
    message: 'category must be OC, BC_A … BC_E, SC, ST, EWS or OTHER',
  })
  category?: ReservationCategory | null;

  /** SENSITIVE. */
  @IsOptional()
  @IsString()
  @Length(2, 50, { message: 'subCaste must be 2 to 50 characters' })
  subCaste?: string | null;

  // Stay and transport

  @IsOptional()
  @IsEnum(Residence, { message: 'residence must be DAY_SCHOLAR or HOSTELLER' })
  residence?: Residence | null;

  @IsOptional()
  @IsBoolean({ message: 'busFacility must be yes or no' })
  busFacility?: boolean;

  /** Required when busFacility is true. @example Gajuwaka bus stop */
  @IsOptional()
  @IsString()
  @Length(2, 100, { message: 'pickupPoint must be 2 to 100 characters' })
  pickupPoint?: string | null;

  // Previous education

  /** @example Narayana Junior College */
  @IsOptional()
  @IsString()
  @Length(2, 150, { message: 'previousInstitution must be 2 to 150 characters' })
  previousInstitution?: string | null;

  @IsOptional()
  @IsEnum(PreviousBoard, {
    message: 'previousBoard must be SSC, CBSE, ICSE, INTERMEDIATE, IB or OTHER',
  })
  previousBoard?: PreviousBoard | null;

  @IsOptional()
  @IsString()
  @Length(4, 20, { message: 'hallTicketNo must be 4 to 20 characters' })
  @Matches(CODE, { message: CODE_MESSAGE('hallTicketNo') })
  hallTicketNo?: string | null;

  /** 0 to 100, at most 2 decimals. @example 92.5 */
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'previousPercentage must be a number (2 decimals at most)' },
  )
  @Min(0, { message: 'previousPercentage must be 0 to 100' })
  @Max(100, { message: 'previousPercentage must be 0 to 100' })
  previousPercentage?: number | null;

  /** GPA or grade. @example 9.2 */
  @IsOptional()
  @IsString()
  @Length(1, 10, { message: 'previousGrade must be at most 10 characters' })
  @Matches(/^[A-Za-z0-9.+-]+$/, {
    message: 'previousGrade may only contain letters, digits, . + and -',
  })
  previousGrade?: string | null;

  // Admission / scholarship test

  @IsOptional()
  @IsString()
  @Length(1, 30, { message: 'admissionTestNo must be at most 30 characters' })
  @Matches(CODE, { message: CODE_MESSAGE('admissionTestNo') })
  admissionTestNo?: string | null;

  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'admissionTestMarks must be a number (2 decimals at most)' },
  )
  @Min(0, { message: 'admissionTestMarks must be 0 to 1000' })
  @Max(1000, { message: 'admissionTestMarks must be 0 to 1000' })
  admissionTestMarks?: number | null;

  // Health and notes

  /** SENSITIVE. */
  @IsOptional()
  @IsString()
  @Length(2, 500, { message: 'medicalCondition must be 2 to 500 characters' })
  medicalCondition?: string | null;

  @IsOptional()
  @IsString()
  @Length(2, 500, { message: 'remarks must be 2 to 500 characters' })
  remarks?: string | null;

  // Top rankers

  @IsOptional()
  @IsBoolean({ message: 'topRanker must be yes or no' })
  topRanker?: boolean;

  @IsOptional()
  @IsEnum(LearnerLevel, { message: 'learnerLevel must be EXPERT, MEDIUM or SLOW' })
  learnerLevel?: LearnerLevel | null;
}

/** The fields that only users with "students.sensitive.view" may see. */
export const SENSITIVE_FIELDS = ['aadhaar', 'category', 'subCaste', 'medicalCondition'] as const;

export class AdmitStudentDto extends StudentDetailsDto {
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
  @IsDateString({ strict: true }, { message: 'admissionDate must be a date (YYYY-MM-DD)' })
  admissionDate: string;

  /** Place the student in a section of the branch right away (optional). */
  @IsOptional()
  @ValidateNested()
  @Type(() => EnrolmentDto)
  enrolment?: EnrolmentDto;

  /** Father, mother, guardian (optional, more can be added later). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuardianDto)
  guardians?: GuardianDto[];
}

/**
 * Editing: every field optional; null clears an optional field. fullName, dateOfBirth and
 * gender can be changed but not cleared.
 */
export class UpdateStudentDto extends PartialType(
  OmitType(StudentDetailsDto, ['fullName', 'dateOfBirth', 'gender'] as const),
) {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Length(2, 100, { message: 'fullName must be 2 to 100 characters' })
  @Matches(NAME, { message: NAME_MESSAGE('fullName') })
  fullName?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsDateString({ strict: true }, { message: 'dateOfBirth must be a date (YYYY-MM-DD)' })
  dateOfBirth?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsEnum(Gender, { message: 'gender must be MALE, FEMALE, OTHER or UNDISCLOSED' })
  gender?: Gender;

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

  /** "true" = only top rankers (the Top rankers page). */
  @IsOptional()
  @IsIn(['true', 'false'])
  topRanker?: 'true' | 'false';

  @IsOptional()
  @IsEnum(LearnerLevel)
  learnerLevel?: LearnerLevel;
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

  /**
   * Only these students of the section (the others stay where they are, e.g. held back).
   * Leave out to promote the whole section; an empty list promotes nobody from it.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('all', { each: true })
  studentIds?: string[];
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
 * One row of an import, as text exactly as in the file (ADR-0031). The service turns the words
 * into values (e.g. "BC-A" -> BC_A, "yes" -> true), then checks the row with the same rules as
 * the admission form (StudentDetailsDto), and reports problems by row number. Where the students
 * go (branch, year, section) is chosen on the screen, not in the file (ADR-0030).
 */
export class ImportRowDto {
  /** Only with MANUAL admission numbers (not in the template with AUTOMATIC). */
  @IsOptional() @IsString() admissionNo?: string;
  @IsOptional() @IsString() admissionDate?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() surname?: string;
  @IsOptional() @IsString() dateOfBirth?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() bloodGroup?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() alternatePhone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() permanentAddress?: string;
  @IsOptional() @IsString() area?: string;
  @IsOptional() @IsString() aadhaar?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() subCaste?: string;
  @IsOptional() @IsString() residence?: string;
  @IsOptional() @IsString() busFacility?: string;
  @IsOptional() @IsString() pickupPoint?: string;
  @IsOptional() @IsString() previousInstitution?: string;
  @IsOptional() @IsString() previousBoard?: string;
  @IsOptional() @IsString() hallTicketNo?: string;
  @IsOptional() @IsString() previousPercentage?: string;
  @IsOptional() @IsString() previousGrade?: string;
  @IsOptional() @IsString() admissionTestNo?: string;
  @IsOptional() @IsString() admissionTestMarks?: string;
  @IsOptional() @IsString() medicalCondition?: string;
  @IsOptional() @IsString() remarks?: string;
  @IsOptional() @IsString() topRanker?: string;
  @IsOptional() @IsString() learnerLevel?: string;
  @IsOptional() @IsString() rollNo?: string;
  @IsOptional() @IsString() fatherName?: string;
  @IsOptional() @IsString() fatherPhone?: string;
  @IsOptional() @IsString() fatherOccupation?: string;
  @IsOptional() @IsString() motherName?: string;
  @IsOptional() @IsString() motherPhone?: string;
  @IsOptional() @IsString() motherOccupation?: string;
  @IsOptional() @IsString() guardianName?: string;
  @IsOptional() @IsString() guardianPhone?: string;
  @IsOptional() @IsString() guardianOccupation?: string;
}

/** Every column an import sheet may have, in the template's order. */
export const IMPORT_COLUMNS = [
  'admissionNo',
  'admissionDate',
  'fullName',
  'surname',
  'dateOfBirth',
  'gender',
  'bloodGroup',
  'phone',
  'alternatePhone',
  'email',
  'address',
  'permanentAddress',
  'area',
  'aadhaar',
  'category',
  'subCaste',
  'residence',
  'busFacility',
  'pickupPoint',
  'previousInstitution',
  'previousBoard',
  'hallTicketNo',
  'previousPercentage',
  'previousGrade',
  'admissionTestNo',
  'admissionTestMarks',
  'medicalCondition',
  'remarks',
  'topRanker',
  'learnerLevel',
  'rollNo',
  'fatherName',
  'fatherPhone',
  'fatherOccupation',
  'motherName',
  'motherPhone',
  'motherOccupation',
  'guardianName',
  'guardianPhone',
  'guardianOccupation',
] as const satisfies readonly (keyof ImportRowDto)[];

export class ImportStudentsDto {
  /** The academic year the students are placed in (not closed). */
  @IsUUID()
  academicYearId: string;

  /** The section every row goes into; its branch is the students' branch. */
  @IsUUID()
  sectionId: string;

  /**
   * true = only check: report which rows would be imported and which excluded, save nothing.
   * false = import the valid rows; the invalid ones are excluded and listed (ADR-0031).
   */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** The sheet's file name, kept on the import record. @example junior-mpc-jee-a.csv */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  fileName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows: ImportRowDto[];
}

export class ImportRunsQuery extends PaginationQuery {
  @IsOptional()
  @IsUUID()
  branchId?: string;
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
