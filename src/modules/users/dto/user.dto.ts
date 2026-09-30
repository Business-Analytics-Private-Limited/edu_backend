/**
 * Request bodies and filters for organization users.
 */
import { UserStatus } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

export class CreateUserDto {
  /** @example Suresh Kumar */
  @IsString()
  @Length(2, 100)
  name: string;

  /** Login email, unique across EduPlatform. @example suresh@srividya.edu.in */
  @IsEmail()
  email: string;

  /** Temporary password; the user changes it after the first login. @example Welcome@2026 */
  @IsString()
  @MinLength(10)
  password: string;

  /**
   * The user's roles (at least one). With several roles, the user may do everything any of
   * them allows, e.g. Principal AND Senior faculty.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  roleIds: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  /** Replaces all the user's roles. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  roleIds?: string[];
}

export class ListUsersQuery extends PaginationQuery {
  /** Part of the name or email. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}
