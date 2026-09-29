/**
 * Login routes.
 *   POST /api/v1/auth/super-admin/login   EduPlatform staff
 *   POST /api/v1/auth/login               organization users
 *   GET  /api/v1/auth/me                  who am I (and what may I do)
 *   POST /api/v1/auth/change-password
 */
import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { LoggedIn, Public } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';

/** At most 10 login attempts per minute from one address, against password guessing. */
const LOGIN_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Login')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('super-admin/login')
  @Public()
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  superAdminLogin(@Body() body: LoginDto) {
    return this.auth.superAdminLogin(body.email, body.password);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  login(@Body() body: LoginDto) {
    return this.auth.userLogin(body.email, body.password);
  }

  /** The logged-in person, their role, permissions and the organization's modules. */
  @Get('me')
  @LoggedIn()
  @ApiBearerAuth()
  me(@CurrentUser() user: CurrentUserType) {
    return user;
  }

  @Post('change-password')
  @LoggedIn()
  @ApiBearerAuth()
  @HttpCode(200)
  changePassword(@CurrentUser() user: CurrentUserType, @Body() body: ChangePasswordDto) {
    return this.auth.changePassword(user, body.currentPassword, body.newPassword);
  }
}
