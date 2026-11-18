/**
 * THE SUPER ADMIN'S AUDIT LOG (ADR-0027): every entry of every organization, plus the platform's
 * own (super admin logins, predefined roles, failed logins with unknown emails), newest first.
 *
 *   GET /api/v1/super-admin/audit-logs?organizationId=&action=&page=&pageSize=
 *
 *   organizationId   one organization, or "platform" for entries that belong to none
 *   action           e.g. "login failed", "deactivate", "download document"
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { SuperAdminOnly } from '../../common/decorators/access.decorators';
import { paginated, PaginationQuery, toSkipTake } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';

const UUID_OR_PLATFORM =
  /^(platform|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export class PlatformAuditQuery extends PaginationQuery {
  /** One organization's id, or "platform" for entries that belong to no organization. */
  @IsOptional()
  @Matches(UUID_OR_PLATFORM, { message: 'organizationId must be an id or "platform"' })
  organizationId?: string;

  /** Only this action, e.g. "login failed". */
  @IsOptional()
  @IsString()
  @Length(1, 50)
  action?: string;
}

@ApiTags('Super admin')
@ApiBearerAuth()
@SuperAdminOnly()
@Controller('super-admin/audit-logs')
export class PlatformAuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query() query: PlatformAuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.organizationId === 'platform'
        ? { organizationId: null }
        : query.organizationId
          ? { organizationId: query.organizationId }
          : {}),
      ...(query.action ? { action: query.action } : {}),
    };
    return this.prisma.forAllOrganizations(async (db) => {
      const [items, total] = await Promise.all([
        db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
        db.auditLog.count({ where }),
      ]);
      // The organization's name next to each entry, so the list reads without ids.
      const ids = [...new Set(items.map((i) => i.organizationId).filter((id) => id !== null))];
      const organizations = await db.organization.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      const nameOf = new Map(organizations.map((o) => [o.id, o.name]));
      return paginated(
        items.map((item) => ({
          ...item,
          organizationName: item.organizationId ? (nameOf.get(item.organizationId) ?? null) : null,
        })),
        total,
        query,
      );
    });
  }
}
