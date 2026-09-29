/**
 * Request bodies for the organization's own details, institutions and campuses.
 */
import { InstitutionType } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';

const CODE = /^[A-Z0-9_-]+$/;
const CODE_MESSAGE = 'code may only contain capital letters, digits, _ and -';

export class UpdateOwnOrganizationDto {
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

export class CreateInstitutionDto {
  /** @example Sri Vidya Junior College */
  @IsString()
  @Length(2, 200)
  name: string;

  /** Short code, unique in the organization. @example SVJC */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(2, 20)
  code: string;

  @IsEnum(InstitutionType)
  type: InstitutionType;
}

export class UpdateInstitutionDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @IsOptional()
  @IsEnum(InstitutionType)
  type?: InstitutionType;
}

export class CreateCampusDto {
  /** @example Kukatpally */
  @IsString()
  @Length(2, 200)
  name: string;

  /** @example KKP */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(2, 20)
  code: string;
}

export class UpdateCampusDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;
}
