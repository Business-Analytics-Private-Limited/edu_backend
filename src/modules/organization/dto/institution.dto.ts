/**
 * Request bodies for the organization's own details, institutions and campuses.
 * CreateInstitutionDto is used by the super admin, who alone adds institutions (ADR-0025).
 */
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

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
}

export class UpdateInstitutionDto {
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;
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
