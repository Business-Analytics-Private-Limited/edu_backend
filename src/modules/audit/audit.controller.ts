/**
 * The organization's audit log, newest first.
 *   GET /api/v1/audit-logs?page=1&pageSize=20
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/decorators/access.decorators';
import { OrganizationId } from '../../common/decorators/current-user.decorator';
import { paginated, PaginationQuery, toSkipTake } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Organization: audit log')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit.log.view')
  list(@OrganizationId() organizationId: string, @Query() query: PaginationQuery) {
    return this.prisma.forOrganization(organizationId, async (db) => {
      const where = { organizationId };
      const [items, total] = await Promise.all([
        db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, ...toSkipTake(query) }),
        db.auditLog.count({ where }),
      ]);
      return paginated(items, total, query);
    });
  }
}
