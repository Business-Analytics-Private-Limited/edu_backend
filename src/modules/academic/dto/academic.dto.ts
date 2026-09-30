/**
 * Request bodies for the Academic module: academic years, class levels, classes, batches.
 */
import { BatchStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';
import { MAX_LEVELS } from '../default-levels';

const CODE = /^[A-Za-z0-9_-]+$/;
const CODE_MESSAGE = 'code may only contain letters, digits, _ and -';

// --- Academic years ------------------------------------------------------------------------------

export class CreateAcademicYearDto {
  @IsUUID()
  institutionId: string;

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

export class InstitutionFilterQuery {
  /** Only this institution's items. */
  @IsOptional()
  @IsUUID()
  institutionId?: string;
}

// --- Class levels and classes -------------------------------------------------------------------

export class SetClassLevelsDto {
  /** Level names from top to bottom. @example ["Year", "Group", "Section"] */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LEVELS)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  names: string[];
}

export class CreateClassDto {
  /** The class this one sits under; leave out for a class of the top level. */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  /** @example MPC */
  @IsString()
  @Length(1, 100)
  name: string;

  /** Unique among its siblings. @example MPC */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

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
}

// --- Batches -------------------------------------------------------------------------------------

export class CreateBatchDto {
  @IsUUID()
  institutionId: string;

  /** @example 2026-28 batch */
  @IsString()
  @Length(2, 100)
  name: string;

  /** Unique in the institution. @example B2026 */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code: string;

  /** Where the batch is now, in the institution's own words. @example Junior */
  @IsString()
  @Length(1, 40)
  stage: string;
}

export class UpdateBatchDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(1, 20)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  stage?: string;

  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;
}
