/**
 * Request bodies for the organization's own details and its branches. CreateBranchDto is used by
 * the super admin, who alone adds branches (ADR-0030).
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

export class CreateBranchDto {
  /** @example KPHB */
  @IsString()
  @Length(2, 200)
  name: string;

  /** Short code, unique in the organization. @example KPHB */
  @Matches(CODE, { message: CODE_MESSAGE })
  @Length(2, 20)
  code: string;
}

export class UpdateBranchDto {
  @IsString()
  @Length(2, 200)
  name: string;
}
