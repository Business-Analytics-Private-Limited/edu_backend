/**
 * Organization lookups.
 *
 *   current()           the signed-in tenant user's organization (APP_POOL, Row-Level Security)
 *   getSummary / bySlug for other services through the facade (PLATFORM_POOL: before a tenant
 *                       context exists, e.g. while resolving a login)
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  APP_POOL,
  NotFoundError,
  PLATFORM_POOL,
  withTenantTransaction,
  withTransaction,
} from '@eduplatform/server-kit';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { tenants } from '../infrastructure/schema';
import type { TenantSummary } from '../public';
import type { OrganizationDto } from './mappers';

const summaryColumns = {
  id: tenants.id,
  slug: tenants.slug,
  displayName: tenants.displayName,
  status: tenants.status,
};

@Injectable()
export class OrganizationService {
  constructor(
    @Inject(APP_POOL) private readonly appPool: Pool,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
  ) {}

  async current(): Promise<OrganizationDto> {
    return withTenantTransaction(this.appPool, async ({ db }) => {
      // Row-Level Security lets a tenant user see exactly one row: their own organization.
      const [row] = await db.select(summaryColumns).from(tenants);
      if (!row) throw new NotFoundError('Organization not found');
      return row;
    });
  }

  async getSummary(tenantId: string): Promise<TenantSummary | null> {
    return withTransaction(this.platformPool, async ({ db }) => {
      const [row] = await db.select(summaryColumns).from(tenants).where(eq(tenants.id, tenantId));
      return row ?? null;
    });
  }

  async findBySlug(slug: string): Promise<TenantSummary | null> {
    return withTransaction(this.platformPool, async ({ db }) => {
      const [row] = await db.select(summaryColumns).from(tenants).where(eq(tenants.slug, slug));
      return row ?? null;
    });
  }
}
