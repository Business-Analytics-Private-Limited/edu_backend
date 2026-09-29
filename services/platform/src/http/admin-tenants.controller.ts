/**
 * Super admin endpoints for organizations: /api/v1/admin/tenants/...
 * Contract: packages/contracts/openapi/platform.yaml (tag "admin").
 *
 * @PlatformEndpoint: only platform staff (Keycloak realm "platform") may call these.
 * Each method declares its permission; the staff member's role must allow it.
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  page,
  parseIfMatch,
  parseInput,
  PlatformEndpoint,
  readPageParams,
  RequireModule,
  RequirePermission,
  UuidPipe,
} from '@eduplatform/server-kit';
import type { ServerResponse } from 'node:http';
import { TenantsService } from '../application/tenants.service';
import {
  addInstitutionSchema,
  createTenantSchema,
  listTenantsQuerySchema,
  statusChangeSchema,
  updateTenantSchema,
} from './requests';

@Controller('admin/tenants')
@PlatformEndpoint()
@RequireModule('platform')
export class AdminTenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  @RequirePermission('admin.tenant.view')
  async list(@Query() query: unknown) {
    const { q, status, ...paging } = parseInput(listTenantsQuerySchema, query);
    const { limit, afterId } = readPageParams(paging);
    const rows = await this.tenants.list({ q, status, limit, afterId });
    return page(rows, limit, (row) => row.id);
  }

  @Post()
  @RequirePermission('admin.tenant.manage')
  async create(@Body() body: unknown) {
    return { data: await this.tenants.create(parseInput(createTenantSchema, body)) };
  }

  @Get(':tenantId')
  @RequirePermission('admin.tenant.view')
  async get(
    @Param('tenantId', UuidPipe) tenantId: string,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const tenant = await this.tenants.get(tenantId);
    response.setHeader('ETag', `"${tenant.version}"`);
    return { data: tenant };
  }

  @Patch(':tenantId')
  @RequirePermission('admin.tenant.manage')
  async update(
    @Param('tenantId', UuidPipe) tenantId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const version = parseIfMatch(ifMatch);
    const tenant = await this.tenants.update(
      tenantId,
      version,
      parseInput(updateTenantSchema, body),
    );
    response.setHeader('ETag', `"${tenant.version}"`);
    return { data: tenant };
  }

  @Post(':tenantId/institutions')
  @RequirePermission('admin.tenant.manage')
  async addInstitution(@Param('tenantId', UuidPipe) tenantId: string, @Body() body: unknown) {
    return {
      data: await this.tenants.addInstitution(tenantId, parseInput(addInstitutionSchema, body)),
    };
  }

  @Post(':tenantId/activate')
  @HttpCode(200)
  @RequirePermission('admin.tenant.manage')
  async activate(@Param('tenantId', UuidPipe) tenantId: string) {
    return { data: await this.tenants.changeStatus(tenantId, 'activate') };
  }

  @Post(':tenantId/suspend')
  @HttpCode(200)
  @RequirePermission('admin.tenant.manage')
  async suspend(@Param('tenantId', UuidPipe) tenantId: string, @Body() body: unknown) {
    const { reason } = parseInput(statusChangeSchema, body);
    return { data: await this.tenants.changeStatus(tenantId, 'suspend', reason) };
  }

  @Post(':tenantId/reactivate')
  @HttpCode(200)
  @RequirePermission('admin.tenant.manage')
  async reactivate(@Param('tenantId', UuidPipe) tenantId: string, @Body() body: unknown) {
    const { reason } = parseInput(statusChangeSchema, body);
    return { data: await this.tenants.changeStatus(tenantId, 'reactivate', reason) };
  }
}
