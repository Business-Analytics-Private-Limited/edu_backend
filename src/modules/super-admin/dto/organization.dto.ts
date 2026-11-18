/**
 * Request bodies and filters for the super admin organization routes.
 * The checks (@IsEmail, @Matches, ...) run automatically before the controller method.
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
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
import { OrganizationStatus, OrganizationType } from '@prisma/client';
import { PaginationQuery } from '../../../common/pagination';
import { CreateBranchDto } from '../../organization/dto/organization.dto';

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
  /** @example Sri Vidya Junior College */
  @IsString()
  @Length(2, 200)
  name: string;

  /** Short unique name: lowercase letters, digits and dashes. @example sri-vidya */
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'slug may only contain lowercase letters, digits and dashes',
  })
  @Length(3, 40)
  slug: string;

  /** Short code used in admission numbers ({CODE}). @example SVJC */
  @Matches(/^[A-Z0-9]+$/, { message: 'code may only contain capital letters and digits' })
  @Length(2, 10)
  code: string;

  /** What kind of institution it is; decides the academic structure (ADR-0030). */
  @IsEnum(OrganizationType)
  type: OrganizationType;

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

  /** The organization's branches (at least one); more can be added later. */
  @IsArray()
  @ArrayMinSize(1, { message: 'add at least one branch' })
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateBranchDto)
  branches: CreateBranchDto[];
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @IsOptional()
  @Matches(/^[A-Z0-9]+$/, { message: 'code may only contain capital letters and digits' })
  @Length(2, 10)
  code?: string;

  /** Only while the organization has no academic structure yet. */
  @IsOptional()
  @IsEnum(OrganizationType)
  type?: OrganizationType;

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
