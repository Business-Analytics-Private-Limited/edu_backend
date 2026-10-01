/**
 * Request bodies and filters for the Attendance module.
 */
import { AttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RosterQuery {
  /** A section (a class of the last level). */
  @IsUUID()
  classId: string;

  /** @example 2026-10-02 */
  @IsDateString({ strict: true })
  date: string;
}

export class MarkEntryDto {
  @IsUUID()
  studentId: string;

  @IsEnum(AttendanceStatus)
  status: AttendanceStatus;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  remark?: string;
}

export class MarkSectionDto {
  @IsUUID()
  classId: string;

  @IsDateString({ strict: true })
  date: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MarkEntryDto)
  entries: MarkEntryDto[];

  /** Required when changing a PAST day's attendance (a correction). */
  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;
}

export class DailySummaryQuery {
  @IsUUID()
  campusId: string;

  @IsDateString({ strict: true })
  date: string;
}

export class RangeQuery {
  /** @example 2026-06-01 */
  @IsDateString({ strict: true })
  from: string;

  /** @example 2026-10-31 */
  @IsDateString({ strict: true })
  to: string;
}

export class SectionReportQuery extends RangeQuery {
  @IsUUID()
  classId: string;
}

export class AttendanceSettingsDto {
  /** e.g. "Asia/Kolkata". */
  @IsOptional()
  @IsString()
  @Length(3, 60)
  timeZone?: string;

  /** How many days back a past day may still be marked or corrected (0 = only today). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  correctionDays?: number;
}
