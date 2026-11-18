/**
 * Request bodies for the parent and student portal.
 */
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class GrantPortalAccessDto {
  /** A login for the STUDENT, or for one of their GUARDIANS (who then sees all their children). */
  @IsIn(['STUDENT', 'GUARDIAN'])
  for: 'STUDENT' | 'GUARDIAN';

  /** Which guardian (one linked to this student); needed when `for` is GUARDIAN. */
  @IsOptional()
  @IsUUID()
  guardianId?: string;

  /** Login email, unique across EduPlatform. */
  @IsEmail()
  email: string;

  /** Temporary password; they change it after the first login. */
  @IsString()
  @MinLength(10)
  password: string;
}

export class PortalRangeQuery {
  /** @example 2026-06-01 */
  @IsDateString({ strict: true })
  from: string;

  /** @example 2026-10-31 */
  @IsDateString({ strict: true })
  to: string;
}
