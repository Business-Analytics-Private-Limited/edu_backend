/**
 * The organization's audit log, newest first.
 *   GET /api/v1/audit-logs?page=1&pageSize=20
 *
 * Someone with "audit.log.view" for the whole organization sees everything. A campus or
 * institution admin sees only the changes made in their own campus / institution.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { CurrentUser as CurrentUserType } from '../../common/current-user';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { CurrentUser, OrganizationId } from '../../common/decorators/current-user.decorator';
import { paginated, PaginationQuery, toSkipTake } from '../../common/pagination';
import { reachOf } from '../../common/scope';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Organization: audit log')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit.log.view')
  list(
    @OrganizationId() organizationId: string,
    @Query() query: PaginationQuery,
    @CurrentUser() user: CurrentUserType,
  ) {
    const reach = reachOf(user, 'audit.log.view');
    const where: Prisma.AuditLogWhereInput = reach.everywhere
      ? { organizationId }
      : {
          organizationId,
          OR: [
            { campusId: { in: reach.campusIds } },
            { institutionId: { in: reach.institutionIds } },
          ],
        };
    return this.prisma.forOrganization(organizationId, async (db) => {
      const [items, total] = await Promise.all([
        db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
        db.auditLog.count({ where }),
      ]);
      return paginated(items, total, query);
    });
  }
}
