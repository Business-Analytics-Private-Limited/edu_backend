/**
 * Request bodies and filters for organization users.
 */
import { UserStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

/**
 * A role and the place it applies to (ADR-0030):
 *   no branchId  -> the whole organization
 *   branchId     -> that branch only
 */
export class RoleAssignmentDto {
  @IsUUID()
  roleId: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;
}

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

  /** At least one role, each with its place. More can be added later. */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roles: RoleAssignmentDto[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;
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
