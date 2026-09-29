/**
 * Entitlements (layer 1 of docs/05-module-catalog.md §5.1): which modules each tenant may use.
 *
 *   put / disable / listForTenant   super admin endpoints (PLATFORM_POOL)
 *   listEnabledForCurrentTenant     tenant endpoint (APP_POOL, under Row-Level Security)
 *   isModuleEnabled                 check 1 of every request, cached (ADR-0014)
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  APP_POOL,
  MemoryCache,
  newId,
  NotFoundError,
  PLATFORM_POOL,
  publishEvent,
  recordPlatformAudit,
  requireContext,
  ValidationError,
  withTenantTransaction,
  withTransaction,
  type Tx,
} from '@eduplatform/server-kit';
import { and, asc, eq, gt, isNull, lte, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { checkDisable, checkEnable, READ_ONLY_DAYS } from '../domain/entitlement-rules';
import { modules, tenantEntitlements, tenants } from '../infrastructure/schema';
import { CatalogService } from './catalog.service';
import { toEntitlementDto, type EntitlementDto } from './mappers';

export interface PutEntitlementInput {
  allowedVariants?: string[];
  limits?: Record<string, number>;
  startsAt?: string;
  endsAt?: string | null;
}

/** "Enabled right now": switched on, started, and not ended. */
const activeNow = and(
  eq(tenantEntitlements.enabled, true),
  lte(tenantEntitlements.startsAt, sql`now()`),
  or(isNull(tenantEntitlements.endsAt), gt(tenantEntitlements.endsAt, sql`now()`)),
);

@Injectable()
export class EntitlementsService {
  /** Answers to "is module X enabled for tenant Y?", for 60 seconds. */
  private readonly enabledCache = new MemoryCache<boolean>(60_000);

  constructor(
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
    @Inject(APP_POOL) private readonly appPool: Pool,
    private readonly catalog: CatalogService,
  ) {}

  /** All entitlements of a tenant, enabled or not (super admin view). */
  async listForTenant(tenantId: string): Promise<EntitlementDto[]> {
    return withTransaction(this.platformPool, async (tx) => {
      await this.requireTenant(tx, tenantId);
      return this.selectWithNames(tx, eq(tenantEntitlements.tenantId, tenantId));
    });
  }

  /** The signed-in user's tenant: modules enabled right now (Row-Level Security applies). */
  async listEnabledForCurrentTenant(): Promise<EntitlementDto[]> {
    return withTenantTransaction(this.appPool, (tx) => this.selectWithNames(tx, activeNow));
  }

  /** Grants a module, or changes its variants, limits and dates. */
  async put(
    tenantId: string,
    moduleKey: string,
    input: PutEntitlementInput,
  ): Promise<EntitlementDto> {
    const staffId = requireContext().userId;
    const result = await withTransaction(this.platformPool, async (tx) => {
      await this.requireTenant(tx, tenantId);
      const catalog = await this.catalog.load(tx);
      const module = catalog.get(moduleKey);

      const current = await tx.db
        .select()
        .from(tenantEntitlements)
        .where(eq(tenantEntitlements.tenantId, tenantId));
      const enabledKeys = new Set(current.filter((e) => e.enabled).map((e) => e.moduleKey));
      const variants = checkEnable(module, input.allowedVariants, enabledKeys);

      // Limits must be ones the module declares, e.g. attendance: devices.max.
      const unknownLimits = Object.keys(input.limits ?? {}).filter(
        (k) => !module!.limitKeys.includes(k),
      );
      if (unknownLimits.length > 0) {
        throw new ValidationError(
          unknownLimits.map((k) => ({
            path: `limits.${k}`,
            code: 'unknown_limit',
            message: `${module!.name} has no limit "${k}"`,
          })),
        );
      }

      const existing = current.find((e) => e.moduleKey === moduleKey);
      const values = {
        enabled: true,
        allowedVariants: variants,
        limits: input.limits ?? existing?.limits ?? {},
        startsAt: input.startsAt ? new Date(input.startsAt) : (existing?.startsAt ?? new Date()),
        endsAt:
          input.endsAt !== undefined
            ? input.endsAt
              ? new Date(input.endsAt)
              : null
            : (existing?.endsAt ?? null),
        readOnlyUntil: null,
        updatedAt: new Date(),
        updatedBy: staffId,
      };

      const [row] = existing
        ? await tx.db
            .update(tenantEntitlements)
            .set({ ...values, version: sql`${tenantEntitlements.version} + 1` })
            .where(eq(tenantEntitlements.id, existing.id))
            .returning()
        : await tx.db
            .insert(tenantEntitlements)
            .values({
              id: newId(),
              tenantId,
              moduleKey,
              source: 'override',
              createdBy: staffId,
              ...values,
            })
            .returning();

      const dto = toEntitlementDto(row!, module!.name);
      await recordPlatformAudit(tx, {
        moduleKey: 'platform',
        entityType: 'platform.entitlement',
        entityId: row!.id,
        action: existing?.enabled ? 'update' : 'enable',
        before: existing ? toEntitlementDto(existing, module!.name) : null,
        after: dto,
        targetTenantId: tenantId,
      });
      await publishEvent(tx, 'platform', {
        type: 'platform.module.enabled',
        subject: `${tenantId}:${moduleKey}`,
        dataSchema: 'platform.module.enabled/1',
        data: { moduleKey, allowedVariants: dto.allowedVariants, limits: dto.limits },
        tenantId,
      });
      return dto;
    });
    this.forgetTenant(tenantId);
    return result;
  }

  /** Takes a module away. No data is deleted: it stays read-only for 90 days. */
  async disable(tenantId: string, moduleKey: string): Promise<EntitlementDto> {
    const staffId = requireContext().userId;
    const result = await withTransaction(this.platformPool, async (tx) => {
      await this.requireTenant(tx, tenantId);
      const catalog = await this.catalog.load(tx);
      const module = catalog.get(moduleKey);

      const current = await tx.db
        .select()
        .from(tenantEntitlements)
        .where(eq(tenantEntitlements.tenantId, tenantId));
      const existing = current.find((e) => e.moduleKey === moduleKey && e.enabled);
      if (!existing) throw new NotFoundError('This module is not granted to the organization');

      const enabledModules = current
        .filter((e) => e.enabled && e.moduleKey !== moduleKey)
        .map((e) => ({ key: e.moduleKey, dependsOn: catalog.get(e.moduleKey)?.dependsOn ?? [] }));
      checkDisable(module, enabledModules);

      const [row] = await tx.db
        .update(tenantEntitlements)
        .set({
          enabled: false,
          readOnlyUntil: sql`now() + make_interval(days => ${READ_ONLY_DAYS})`,
          updatedAt: new Date(),
          updatedBy: staffId,
          version: sql`${tenantEntitlements.version} + 1`,
        })
        .where(eq(tenantEntitlements.id, existing.id))
        .returning();

      const dto = toEntitlementDto(row!, module!.name);
      await recordPlatformAudit(tx, {
        moduleKey: 'platform',
        entityType: 'platform.entitlement',
        entityId: row!.id,
        action: 'disable',
        before: toEntitlementDto(existing, module!.name),
        after: dto,
        targetTenantId: tenantId,
      });
      await publishEvent(tx, 'platform', {
        type: 'platform.module.disabled',
        subject: `${tenantId}:${moduleKey}`,
        dataSchema: 'platform.module.disabled/1',
        data: { moduleKey, readOnlyUntil: dto.readOnlyUntil },
        tenantId,
      });
      return dto;
    });
    this.forgetTenant(tenantId);
    return result;
  }

  /** Check 1 of doc 4 §4.1, asked on every request: cached, and under Row-Level Security. */
  isModuleEnabled(tenantId: string, moduleKey: string): Promise<boolean> {
    return this.enabledCache.getOrLoad(`${tenantId}:${moduleKey}`, () =>
      withTenantTransaction(
        this.appPool,
        async ({ db }) => {
          const rows = await db
            .select({ id: tenantEntitlements.id })
            .from(tenantEntitlements)
            .where(and(eq(tenantEntitlements.moduleKey, moduleKey), activeNow));
          return rows.length > 0;
        },
        tenantId,
      ),
    );
  }

  private forgetTenant(tenantId: string): void {
    this.enabledCache.invalidate((key) => key.startsWith(`${tenantId}:`));
  }

  private async requireTenant(tx: Tx, tenantId: string): Promise<void> {
    const [row] = await tx.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!row) throw new NotFoundError('No organization with this id');
  }

  private async selectWithNames(tx: Tx, where: ReturnType<typeof and>): Promise<EntitlementDto[]> {
    const rows = await tx.db
      .select({ entitlement: tenantEntitlements, moduleName: modules.name })
      .from(tenantEntitlements)
      .innerJoin(modules, eq(modules.key, tenantEntitlements.moduleKey))
      .where(where)
      .orderBy(asc(tenantEntitlements.moduleKey));
    return rows.map((r) => toEntitlementDto(r.entitlement, r.moduleName));
  }
}
