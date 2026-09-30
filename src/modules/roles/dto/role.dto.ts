/**
 * Request bodies for roles.
 */
import { ArrayUnique, IsArray, IsOptional, IsString, Length } from 'class-validator';

export class CreateRoleDto {
  /** @example Teacher */
  @IsString()
  @Length(2, 60)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Permission keys from GET /permissions. @example ["platform.institution.view"] */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}

/** The super admin changes a predefined role's permissions. */
export class UpdatePredefinedRoleDto {
  /** Permission keys from GET /super-admin/permissions. @example ["students.student.view"] */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];
}
