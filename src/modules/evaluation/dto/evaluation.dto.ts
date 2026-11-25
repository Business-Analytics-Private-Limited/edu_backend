/**
 * What the Evaluation endpoints accept (ADR-0035). Every field is checked here before a service
 * sees it; the services check what needs the database (does the subject exist, may the user ...).
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const CODE = /^[A-Za-z0-9_-]+$/;
const CODE_MESSAGE = 'code may only contain letters, digits, _ and -';

// --- Exam types ----------------------------------------------------------------------------------

export class CreateExamTypeDto {
  /** @example Quarterly */
  @IsString()
  @Length(1, 100)
  name: string;

  /** Short code, unique in the organization. @example Q */
  @IsString()
  @Length(1, 20)
  @Matches(CODE, { message: CODE_MESSAGE })
  code: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateExamTypeDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  @Matches(CODE, { message: CODE_MESSAGE })
  code?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

// --- Exams ---------------------------------------------------------------------------------------

/** One subject of an exam with its marks. */
export class ExamSubjectDto {
  @IsUUID()
  subjectId: string;

  /** @example 100 */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(1000)
  maxMarks: number;

  /** @example 35 */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000)
  passMarks: number;

  /** @example 2026-12-08 */
  @IsOptional()
  @IsDateString({ strict: true })
  examDate?: string;
}

export class CreateExamDto {
  @IsUUID()
  examTypeId: string;

  @IsUUID()
  academicYearId: string;

  /** Unique in the academic year. @example Quarterly exam, December 2026 */
  @IsString()
  @Length(1, 150)
  name: string;

  /** The part of the structure the exam is for: a year, group, stream or one section. */
  @IsUUID()
  classId: string;

  /** One branch; leave it out for every branch. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** @example 2026-12-08 */
  @IsDateString({ strict: true })
  startsOn: string;

  /** @example 2026-12-14 */
  @IsDateString({ strict: true })
  endsOn: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExamSubjectDto)
  subjects: ExamSubjectDto[];
}

/** Changes to an exam. `subjects` (when given) replaces the list: see ExamsService.update. */
export class UpdateExamDto {
  @IsOptional()
  @IsUUID()
  examTypeId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 150)
  name?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  startsOn?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ExamSubjectDto)
  subjects?: ExamSubjectDto[];
}

export class ExamsQuery {
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  examTypeId?: string;

  @IsOptional()
  @IsIn(['OPEN', 'LOCKED'])
  status?: 'OPEN' | 'LOCKED';
}

// --- Marks ---------------------------------------------------------------------------------------

export class SectionQuery {
  /** A section taking part in the exam. */
  @IsUUID()
  sectionId: string;
}

export class OptionalSectionQuery {
  @IsOptional()
  @IsUUID()
  sectionId?: string;
}

/** One cell of the marks grid. */
export class MarkEntryDto {
  @IsUUID()
  studentId: string;

  @IsUUID()
  subjectId: string;

  /** PRESENT with marks, ABSENT, EXEMPT, or CLEAR to remove an entered mark. */
  @IsIn(['PRESENT', 'ABSENT', 'EXEMPT', 'CLEAR'])
  status: 'PRESENT' | 'ABSENT' | 'EXEMPT' | 'CLEAR';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  marks?: number;
}

export class SaveMarksDto {
  @IsUUID()
  sectionId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => MarkEntryDto)
  entries: MarkEntryDto[];
}

/**
 * A CSV of marks, already split into rows by the web app: each row maps a column heading to its
 * text, e.g. { admissionNo: "201602", MAT: "78", PHY: "AB" }.
 */
export class UploadMarksDto {
  /** true = only check, save nothing ("Check the file"). */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** @example quarterly-junior-mpc.csv */
  @IsOptional()
  @IsString()
  @Length(1, 200)
  fileName?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @IsObject({ each: true })
  rows: Record<string, string>[];
}
