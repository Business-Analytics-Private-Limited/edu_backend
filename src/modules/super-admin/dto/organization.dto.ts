/**
 * Request bodies and filters for the super admin organization routes.
 * The checks (@IsEmail, @Matches, ...) run automatically before the controller method.
 */
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrganizationStatus } from '@prisma/client';
import { PaginationQuery } from '../../../common/pagination';

/** The organization's first admin, created together with the organization. */
export class FirstAdminDto {
  /** @example Lakshmi Rao */
  @IsString()
  @Length(2, 100)
  name: string;

  /** @example admin@srividya.edu.in */
  @IsEmail()
  email: string;

  /** Temporary password; the admin changes it after the first login. @example Welcome@2026 */
  @IsString()
  @MinLength(10)
  password: string;
}

export class CreateOrganizationDto {
  /** @example Sri Vidya Educational Society */
  @IsString()
  @Length(2, 200)
  name: string;

  /** Short unique name: lowercase letters, digits and dashes. @example sri-vidya */
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug may only contain lowercase letters, digits and dashes',
  })
  @Length(3, 40)
  slug: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @ValidateNested()
  @Type(() => FirstAdminDto)
  admin: FirstAdminDto;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;
}

export class ListOrganizationsQuery extends PaginationQuery {
  /** Part of the name or slug. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;
}

export class SetModuleDto {
  /** true = switch the module on, false = switch it off. */
  @IsBoolean()
  enabled: boolean;
}
