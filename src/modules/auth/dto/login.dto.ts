import { IsEmail, IsString, MinLength } from 'class-validator';

/** Body of POST /auth/login and POST /auth/super-admin/login. */
export class LoginDto {
  /** @example admin@srividya.edu.in */
  @IsEmail()
  email: string;

  /** @example ChangeMe@12345 */
  @IsString()
  @MinLength(1)
  password: string;
}
