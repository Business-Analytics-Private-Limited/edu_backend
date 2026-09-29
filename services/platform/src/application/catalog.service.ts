/**
 * The module catalog (docs/05-module-catalog.md §5.3).
 *
 * At startup it copies every module manifest into platform.modules / platform.module_variants,
 * so the database always matches the code that is deployed. Manifests come from:
 *   1. the services the host runs (MODULE_MANIFESTS, provided by the host), and
 *   2. PLANNED_MODULES, for v1 modules whose service isn't built yet.
 * A service's own manifest wins over a planned one with the same key.
 */
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { ModuleManifest } from '@eduplatform/contracts';
import { PLATFORM_POOL, withTransaction, type Tx } from '@eduplatform/server-kit';
import { asc, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { PLANNED_MODULES } from '../catalog/planned-modules';
import type { CatalogModule } from '../domain/entitlement-rules';
import { modules, moduleVariants } from '../infrastructure/schema';
import { MODULE_MANIFESTS } from '../public';
import { toModuleDto, type ModuleDto } from './mappers';

/** A catalog module with what the rules and services need. */
export interface CatalogEntry extends CatalogModule {
  limitKeys: string[];
}

@Injectable()
export class CatalogService implements OnApplicationBootstrap {
  constructor(
    @Inject(PLATFORM_POOL) private readonly pool: Pool,
    @Inject(MODULE_MANIFESTS) private readonly manifests: ModuleManifest[],
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  /** Upserts every manifest into the catalog. Safe to run on every start. */
  async sync(): Promise<void> {
    const byKey = new Map<string, ModuleManifest>();
    for (const manifest of PLANNED_MODULES) byKey.set(manifest.key, manifest);
    for (const manifest of this.manifests) byKey.set(manifest.key, manifest); // real ones win

    await withTransaction(this.pool, async ({ db }) => {
      for (const manifest of byKey.values()) {
        const fields = {
          name: manifest.name,
          category: manifest.category,
          manifestVersion: manifest.version,
          dependsOn: manifest.dependsOn,
          appliesTo: manifest.appliesTo,
          isCore: manifest.core ?? false,
          status: 'available' as const,
          manifest,
          syncedAt: new Date(),
        };
        await db
          .insert(modules)
          .values({ key: manifest.key, ...fields })
          .onConflictDoUpdate({ target: modules.key, set: fields });

        for (const variant of manifest.variants) {
          const variantRow = {
            moduleKey: manifest.key,
            key: variant.key,
            name: variant.name,
            isDefault: variant.default ?? false,
            status: variant.status ?? ('available' as const),
            settingsSchema: variant.settingsSchema ?? null,
          };
          await db
            .insert(moduleVariants)
            .values(variantRow)
            .onConflictDoUpdate({
              target: [moduleVariants.moduleKey, moduleVariants.key],
              set: {
                name: variantRow.name,
                isDefault: variantRow.isDefault,
                status: variantRow.status,
                settingsSchema: variantRow.settingsSchema,
              },
            });
        }
      }
    });
  }

  /** The whole catalog as API responses. */
  async list(): Promise<ModuleDto[]> {
    return withTransaction(this.pool, async ({ db }) => {
      const rows = await db.select().from(modules).orderBy(asc(modules.key));
      const variants = await db
        .select()
        .from(moduleVariants)
        .orderBy(
          asc(moduleVariants.moduleKey),
          sql`${moduleVariants.isDefault} desc`,
          asc(moduleVariants.key),
        );
      return rows.map((row) => toModuleDto(row, variants));
    });
  }

  /** The catalog for the entitlement rules, read inside the caller's transaction. */
  async load(tx: Tx): Promise<Map<string, CatalogEntry>> {
    const rows = await tx.db.select().from(modules);
    const variants = await tx.db.select().from(moduleVariants);
    return new Map(
      rows.map((row) => [
        row.key,
        {
          key: row.key,
          name: row.name,
          isCore: row.isCore,
          status: row.status,
          dependsOn: row.dependsOn,
          variants: variants
            .filter((v) => v.moduleKey === row.key)
            .map((v) => ({ key: v.key, isDefault: v.isDefault, status: v.status })),
          limitKeys: ((row.manifest as ModuleManifest).limits ?? []).map((l) => l.key),
        },
      ]),
    );
  }
}
