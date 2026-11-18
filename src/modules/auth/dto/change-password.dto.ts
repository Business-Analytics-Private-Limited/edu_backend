import { IsString, Matches, MinLength } from 'class-validator';

/** Body of POST /auth/change-password. */
export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  /** At least 10 characters, with a letter and a digit. */
  @IsString()
  @MinLength(10)
  @Matches(/[A-Za-z]/, { message: 'newPassword must contain a letter' })
  @Matches(/\d/, { message: 'newPassword must contain a digit' })
  newPassword: string;
}
