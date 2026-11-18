/**
 * TWO-STEP LOGIN for super admins (ADR-0028): after the password, a 6-digit code from an
 * authenticator app (Google Authenticator, Microsoft Authenticator, ...), which changes every
 * 30 seconds. Whoever steals the password still can't log in without the phone.
 *
 *   POST   /api/v1/auth/two-factor/setup     a new secret; GET pending shows its QR code
 *   GET    /api/v1/auth/two-factor/pending   the QR code and secret of a setup not confirmed yet
 *   POST   /api/v1/auth/two-factor/enable    { code }: the app works, turn it on
 *   POST   /api/v1/auth/two-factor/disable   { password, code }: turn it off
 *
 * The secret is stored encrypted (src/common/secret-box.ts).
 */
import { BadRequestException, Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import { IsString, Matches, MinLength } from 'class-validator';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { SuperAdminOnly } from '../../common/decorators/access.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { open, seal } from '../../common/secret-box';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const CODE = /^\d{6}$/;
const CODE_MESSAGE = 'code must be the 6 digits from the authenticator app';

export class EnableTwoFactorDto {
  /** @example 123456 */
  @Matches(CODE, { message: CODE_MESSAGE })
  code: string;
}

export class DisableTwoFactorDto {
  @IsString()
  @MinLength(1)
  password: string;

  @Matches(CODE, { message: CODE_MESSAGE })
  code: string;
}

@ApiTags('Login')
@ApiBearerAuth()
@SuperAdminOnly()
@Controller('auth/two-factor')
export class TwoFactorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Starts (or restarts) the setup with a new secret. Not active until confirmed. */
  @Post('setup')
  @HttpCode(200)
  async setup(@CurrentUser() user: CurrentUserType) {
    await this.prisma.forAllOrganizations(async (db) => {
      const admin = await db.superAdmin.findUniqueOrThrow({ where: { id: user.id } });
      if (admin.totpEnabled) throw new BadRequestException('Two-step login is already on');
      await db.superAdmin.update({
        where: { id: user.id },
        data: { totpSecret: seal(authenticator.generateSecret()) },
      });
      await this.audit.log(db, user, {
        action: 'two-step login setup',
        entity: 'super_admin',
        entityId: user.id,
        organizationId: null,
      });
    });
    return this.pending(user);
  }

  /** What the authenticator app needs: a QR code to scan, or the secret to type in. */
  @Get('pending')
  async pending(@CurrentUser() user: CurrentUserType) {
    const admin = await this.prisma.superAdmin.findUniqueOrThrow({ where: { id: user.id } });
    if (admin.totpEnabled || !admin.totpSecret) {
      throw new BadRequestException('No two-step login setup is waiting');
    }
    const secret = open(admin.totpSecret);
    const otpauthUrl = authenticator.keyuri(admin.email, 'EduPlatform', secret);
    return { secret, otpauthUrl, qrCode: await QRCode.toDataURL(otpauthUrl) };
  }

  @Post('enable')
  @HttpCode(200)
  async enable(@CurrentUser() user: CurrentUserType, @Body() body: EnableTwoFactorDto) {
    await this.prisma.forAllOrganizations(async (db) => {
      const admin = await db.superAdmin.findUniqueOrThrow({ where: { id: user.id } });
      if (admin.totpEnabled) throw new BadRequestException('Two-step login is already on');
      if (!admin.totpSecret) throw new BadRequestException('Start the setup first');
      if (!authenticator.check(body.code, open(admin.totpSecret))) {
        throw new BadRequestException('That code is not right; check the time on your phone');
      }
      await db.superAdmin.update({ where: { id: user.id }, data: { totpEnabled: true } });
      await this.audit.log(db, user, {
        action: 'two-step login on',
        entity: 'super_admin',
        entityId: user.id,
        organizationId: null,
      });
    });
    return { twoFactor: 'on' };
  }

  @Post('disable')
  @HttpCode(200)
  async disable(@CurrentUser() user: CurrentUserType, @Body() body: DisableTwoFactorDto) {
    await this.prisma.forAllOrganizations(async (db) => {
      const admin = await db.superAdmin.findUniqueOrThrow({ where: { id: user.id } });
      if (!admin.totpEnabled || !admin.totpSecret) {
        throw new BadRequestException('Two-step login is not on');
      }
      if (
        !(await bcrypt.compare(body.password, admin.passwordHash)) ||
        !authenticator.check(body.code, open(admin.totpSecret))
      ) {
        throw new BadRequestException('The password or the code is not right');
      }
      await db.superAdmin.update({
        where: { id: user.id },
        data: { totpEnabled: false, totpSecret: null },
      });
      await this.audit.log(db, user, {
        action: 'two-step login off',
        entity: 'super_admin',
        entityId: user.id,
        organizationId: null,
      });
    });
    return { twoFactor: 'off' };
  }
}
