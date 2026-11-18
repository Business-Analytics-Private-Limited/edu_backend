import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

/** Body of POST /auth/login and POST /auth/super-admin/login. */
export class LoginDto {
  /** @example admin@srividya.edu.in */
  @IsEmail()
  email: string;

  /** @example ChangeMe@12345 */
  @IsString()
  @MinLength(1)
  password: string;

  /** Super admins with two-step login: the 6-digit code from the authenticator app. */
  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'code must be the 6 digits from the authenticator app' })
  code?: string;
}
