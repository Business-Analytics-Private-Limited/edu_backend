/**
 * Request bodies for the Academic module: academic years, the academic structure (levels,
 * built-in classes / groups, streams, courses, sections), subjects and the calendar.
 */
import {
  ArrayMaxSize,
  ArrayUnique,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const CODE = /^[A-Za-z0-9_-]+$/;
const CODE_MESSAGE = 'code may only contain letters, digits, _ and -';

// --- Academic years ------------------------------------------------------------------------------

export class CreateAcademicYearDto {
  /** @example 2026-27 */
  @IsString()
  @Length(2, 40)
  name: string;

  /** @example 2026-06-01 */
  @IsDateString({ strict: true })
  startsOn: string;

  /** @example 2027-03-31 */
  @IsDateString({ strict: true })
  endsOn: string;
}

export class UpdateAcademicYearDto {
  @IsOptional()
  @IsString()
  @Length(2, 40)
  name?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  startsOn?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;
}

// --- The academic structure ----------------------------------------------------------------------

export class SetLevelNamesDto {
  /** New names for the levels, top to bottom (as many as the type has). @example ["Year", "Group", "Stream", "Section"] */
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  names: string[];
}

export class SetCodesDto {
  /**
   * The built-in classes (School: e.g. ["NUR", "LKG", "C1"]) or groups (Intermediate: e.g.
   * ["MPC", "BIPC"]) the organization runs.
   */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  codes: string[];
}

export class AddStreamDto {
  /** The group it belongs to. @example MPC */
  @IsString()
  groupCode: string;

  /** @example JEE Mains */
  @IsString()
  @Length(1, 100)
  name: string;

  /** Unique in the group. @example JEEM */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code: string;

  /** For long-term students only (e.g. NEET Long Term): it sits under the Long Term year. */
  @IsOptional()
  @IsBoolean()
  longTerm?: boolean;
}

export class RenameDto {
  @IsString()
  @Length(1, 100)
  name: string;
}

export class AddCourseDto {
  /** @example B.Com */
  @IsString()
  @Length(1, 100)
  name: string;

  /** @example BCOM */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code: string;

  /**
   * A course WITHOUT specializations: its years of study (1st Year ... Nth Year), ADR-0033.
   * Leave out for a course whose specializations (CSE, ECE ...) are added next. @example 3
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  years?: number;
}

/** Editing a course or a specialization: name, code, and (where it has its own) years. */
export class UpdateProgrammeDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code?: string;

  /**
   * More years are added at the end; fewer remove the last years, only while they are empty.
   * A course: only when it has no specializations. @example 4
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8)
  years?: number;
}

export class AddSpecializationDto {
  /** @example Computer Science and Engineering */
  @IsString()
  @Length(1, 100)
  name: string;

  /** @example CSE */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code: string;

  /** How many years of study (1st Year ... Nth Year). @example 4 */
  @IsInt()
  @Min(1)
  @Max(8)
  years: number;
}

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  /** Not for built-in classes. */
  @IsOptional()
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** false = no longer used (kept for history); true = in use again. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /**
   * Year-level classes only: where students go at promotion; null = they complete after this
   * year.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  nextClassId?: string | null;
}

export class CreateSectionDto {
  /** The class it sits under: one of the level just above Section (e.g. a stream). */
  @IsUUID()
  parentId: string;

  /** @example JEE-A */
  @IsString()
  @Length(1, 100)
  name: string;

  /** Unique under its parent in this branch. @example JEEA */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

// --- Subjects ------------------------------------------------------------------------------------

export class CreateSubjectDto {
  /** @example Mathematics */
  @IsString()
  @Length(2, 100)
  name: string;

  /** Unique in the organization. @example MATHS */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code: string;
}

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code?: string;

  /** false = not in use any more (kept for history). */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetClassSubjectsDto {
  /** The class's own subjects; an empty list removes them all. */
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  subjectIds: string[];
}

// --- Calendar ------------------------------------------------------------------------------------

export class SetWeeklyOffDto {
  /** Days without classes every week: 0 = Sunday ... 6 = Saturday. @example [0] */
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  days: number[];
}

export class CreateHolidayDto {
  /** Only this branch; leave out for every branch. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** @example Sankranti */
  @IsString()
  @Length(2, 100)
  name: string;

  /** @example 2027-01-13 */
  @IsDateString({ strict: true })
  startsOn: string;

  /** Last day; leave out for a one-day holiday. @example 2027-01-16 */
  @IsOptional()
  @IsDateString({ strict: true })
  endsOn?: string;
}

export class HolidayQuery {
  /** Only holidays touching this range. @example 2026-06-01 */
  @IsOptional()
  @IsDateString({ strict: true })
  from?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  to?: string;
}
