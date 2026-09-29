/**
 * Organizations (tenants): onboarding, search, details, institutions, status changes.
 * Used by the super admin endpoints, so it works on the PLATFORM_POOL (role edu_platform, which
 * sees every tenant in schema "platform", ADR-0009).
 *
 * Every change writes, in the same transaction:
 *   - an audit entry (audit.platform_entries, CLAUDE.md rule 9),
 *   - an event in platform.outbox for other services (CLAUDE.md rule 8).
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  ConflictError,
  isUniqueViolation,
  newId,
  NotFoundError,
  PLATFORM_POOL,
  publishEvent,
  recordPlatformAudit,
  requireContext,
  VersionConflictError,
  withTransaction,
  type Tx,
} from '@eduplatform/server-kit';
import { and, asc, count, desc, eq, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Pool } from 'pg';
import {
  nextStatus,
  TEMPLATE_BY_TYPE,
  type StatusAction,
  type TenantStatus,
} from '../domain/tenant-rules';
import {
  campuses,
  institutions,
  modules,
  tenantEntitlements,
  tenantPlacements,
  tenants,
  type ContactJson,
  type TenantRow,
} from '../infrastructure/schema';
import { CatalogService } from './catalog.service';
import {
  toEntitlementDto,
  toInstitutionDto,
  toTenantDto,
  type InstitutionDto,
  type TenantDetailDto,
  type TenantDto,
} from './mappers';

export interface CreateTenantInput {
  slug: string;
  legalName: string;
  displayName: string;
  primaryContact?: ContactJson;
}

export interface UpdateTenantInput {
  legalName?: string;
  displayName?: string;
  primaryContact?: ContactJson;
}

export interface AddInstitutionInput {
  code: string;
  name: string;
  shortName?: string;
  type: keyof typeof TEMPLATE_BY_TYPE;
  timezone?: string;
  campus: { code: string; name: string };
}

@Injectable()
export class TenantsService {
  constructor(
    @Inject(PLATFORM_POOL) private readonly pool: Pool,
    private readonly catalog: CatalogService,
  ) {}

  /** Newest first; `q` matches slug or display name. Returns limit + 1 rows (see pagination). */
  async list(filter: {
    q?: string;
    status?: TenantStatus;
    limit: number;
    afterId?: string;
  }): Promise<TenantDto[]> {
    const conditions: SQL[] = [];
    if (filter.q) {
      const pattern = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(or(ilike(tenants.slug, pattern), ilike(tenants.displayName, pattern))!);
    }
    if (filter.status) conditions.push(eq(tenants.status, filter.status));
    if (filter.afterId) conditions.push(lt(tenants.id, filter.afterId));

    return withTransaction(this.pool, async ({ db }) => {
      const rows = await db
        .select()
        .from(tenants)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(tenants.id))
        .limit(filter.limit + 1);
      return rows.map(toTenantDto);
    });
  }

  /**
   * Starts onboarding: the tenant (status "onboarding"), its placement, and the core modules
   * enabled. Institutions, modules and the first admin are added in the next steps.
   */
  async create(input: CreateTenantInput): Promise<TenantDto> {
    const staffId = requireContext().userId;
    try {
      return await withTransaction(this.pool, async (tx) => {
        const id = newId();
        const [row] = await tx.db
          .insert(tenants)
          .values({
            id,
            slug: input.slug,
            legalName: input.legalName,
            displayName: input.displayName,
            primaryContact: input.primaryContact ?? null,
            createdBy: staffId,
            updatedBy: staffId,
          })
          .returning();

        // Everyone lives in the primary database for now (silo option, ADR-0002).
        await tx.db.insert(tenantPlacements).values({
          tenantId: id,
          clusterKey: 'primary',
          databaseName: sql<string>`current_database()`,
        });

        // Core modules (platform, identity, access, audit, files) are part of every tenant.
        const catalog = await this.catalog.load(tx);
        for (const module of catalog.values()) {
          if (!module.isCore) continue;
          await tx.db.insert(tenantEntitlements).values({
            id: newId(),
            tenantId: id,
            moduleKey: module.key,
            enabled: true,
            allowedVariants: module.variants.filter((v) => v.isDefault).map((v) => v.key),
            source: 'core',
            createdBy: staffId,
            updatedBy: staffId,
          });
        }

        const dto = toTenantDto(row!);
        await recordPlatformAudit(tx, {
          moduleKey: 'platform',
          entityType: 'platform.tenant',
          entityId: id,
          action: 'create',
          after: dto,
          targetTenantId: id,
        });
        await publishEvent(tx, 'platform', {
          type: 'platform.tenant.created',
          subject: id,
          dataSchema: 'platform.tenant.created/1',
          data: { tenantId: id, slug: dto.slug, displayName: dto.displayName },
          tenantId: id,
        });
        return dto;
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictError(`The slug "${input.slug}" is already used`);
      throw error;
    }
  }

  /** The tenant with its institutions, campuses and entitlements. */
  async get(tenantId: string): Promise<TenantDetailDto> {
    return withTransaction(this.pool, async (tx) => {
      const tenant = await this.findTenant(tx, tenantId);
      const institutionRows = await tx.db
        .select()
        .from(institutions)
        .where(and(eq(institutions.tenantId, tenantId), isNull(institutions.deletedAt)))
        .orderBy(asc(institutions.code));
      const campusRows = await tx.db
        .select()
        .from(campuses)
        .where(and(eq(campuses.tenantId, tenantId), isNull(campuses.deletedAt)))
        .orderBy(asc(campuses.code));
      const entitlementRows = await tx.db
        .select({ entitlement: tenantEntitlements, moduleName: modules.name })
        .from(tenantEntitlements)
        .innerJoin(modules, eq(modules.key, tenantEntitlements.moduleKey))
        .where(eq(tenantEntitlements.tenantId, tenantId))
        .orderBy(asc(tenantEntitlements.moduleKey));

      return {
        ...toTenantDto(tenant),
        institutions: institutionRows.map((row) => toInstitutionDto(row, campusRows)),
        entitlements: entitlementRows.map((r) => toEntitlementDto(r.entitlement, r.moduleName)),
      };
    });
  }

  /** Edits details. `expectedVersion` comes from If-Match (optimistic locking). */
  async update(
    tenantId: string,
    expectedVersion: number,
    input: UpdateTenantInput,
  ): Promise<TenantDto> {
    const staffId = requireContext().userId;
    return withTransaction(this.pool, async (tx) => {
      const before = await this.findTenant(tx, tenantId);
      const [row] = await tx.db
        .update(tenants)
        .set({
          ...input,
          updatedAt: new Date(),
          updatedBy: staffId,
          version: sql`${tenants.version} + 1`,
        })
        .where(and(eq(tenants.id, tenantId), eq(tenants.version, expectedVersion)))
        .returning();
      if (!row) throw new VersionConflictError();

      const dto = toTenantDto(row);
      await recordPlatformAudit(tx, {
        moduleKey: 'platform',
        entityType: 'platform.tenant',
        entityId: tenantId,
        action: 'update',
        before: toTenantDto(before),
        after: dto,
        targetTenantId: tenantId,
      });
      return dto;
    });
  }

  /** Adds an institution with its first campus (every institution has at least one). */
  async addInstitution(tenantId: string, input: AddInstitutionInput): Promise<InstitutionDto> {
    const staffId = requireContext().userId;
    try {
      return await withTransaction(this.pool, async (tx) => {
        const tenant = await this.findTenant(tx, tenantId);
        if (tenant.status === 'closed') throw new NotFoundError('The organization is closed');

        const institutionId = newId();
        const [institution] = await tx.db
          .insert(institutions)
          .values({
            id: institutionId,
            tenantId,
            code: input.code,
            name: input.name,
            shortName: input.shortName ?? null,
            type: input.type,
            structureTemplateKey: TEMPLATE_BY_TYPE[input.type],
            ...(input.timezone ? { timezone: input.timezone } : {}),
            createdBy: staffId,
            updatedBy: staffId,
          })
          .returning();
        const campusRows = await tx.db
          .insert(campuses)
          .values({
            id: newId(),
            tenantId,
            institutionId,
            code: input.campus.code,
            name: input.campus.name,
            createdBy: staffId,
            updatedBy: staffId,
          })
          .returning();

        const dto = toInstitutionDto(institution!, campusRows);
        await recordPlatformAudit(tx, {
          moduleKey: 'platform',
          entityType: 'platform.institution',
          entityId: institutionId,
          action: 'create',
          after: dto,
          targetTenantId: tenantId,
        });
        await publishEvent(tx, 'platform', {
          type: 'platform.institution.changed',
          subject: institutionId,
          dataSchema: 'platform.institution.changed/1',
          data: { institutionId, change: 'created', type: dto.type },
          tenantId,
        });
        return dto;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError('An institution or campus with this code already exists');
      }
      throw error;
    }
  }

  /** activate (onboarding → active), suspend (active → suspended), reactivate (suspended → active). */
  async changeStatus(tenantId: string, action: StatusAction, reason?: string): Promise<TenantDto> {
    const staffId = requireContext().userId;
    return withTransaction(this.pool, async (tx) => {
      const before = await this.findTenant(tx, tenantId);
      const [{ institutionCount } = { institutionCount: 0 }] = await tx.db
        .select({ institutionCount: count() })
        .from(institutions)
        .where(and(eq(institutions.tenantId, tenantId), isNull(institutions.deletedAt)));

      const status = nextStatus(before.status, action, institutionCount);
      const [row] = await tx.db
        .update(tenants)
        .set({
          status,
          statusReason: reason ?? null,
          updatedAt: new Date(),
          updatedBy: staffId,
          version: sql`${tenants.version} + 1`,
        })
        .where(eq(tenants.id, tenantId))
        .returning();

      const dto = toTenantDto(row!);
      await recordPlatformAudit(tx, {
        moduleKey: 'platform',
        entityType: 'platform.tenant',
        entityId: tenantId,
        action,
        before: { status: before.status },
        after: { status },
        reason,
        targetTenantId: tenantId,
      });
      await publishEvent(tx, 'platform', {
        type: 'platform.tenant.status_changed',
        subject: tenantId,
        dataSchema: 'platform.tenant.status_changed/1',
        data: { tenantId, from: before.status, to: status, reason: reason ?? null },
        tenantId,
      });
      return dto;
    });
  }

  private async findTenant(tx: Tx, tenantId: string): Promise<TenantRow> {
    const [row] = await tx.db.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!row) throw new NotFoundError('No organization with this id');
    return row;
  }
}
