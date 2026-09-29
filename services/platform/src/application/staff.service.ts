/**
 * Platform staff: who may use the super admin console, and with which role.
 * Staff accounts are managed in Keycloak (realm "platform") and linked here by keycloak_sub
 * (see apps/api/src/cli/add-platform-staff.cli.ts).
 */
import { Inject, Injectable } from '@nestjs/common';
import { MemoryCache, PLATFORM_POOL, withTransaction } from '@eduplatform/server-kit';
import { and, eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { staffRoleAllows, type StaffRole } from '../domain/staff-permissions';
import { platformUsers } from '../infrastructure/schema';

@Injectable()
export class StaffService {
  /** Staff id → role (or null when disabled), for 60 seconds. */
  private readonly roles = new MemoryCache<StaffRole | null>(60_000);

  constructor(@Inject(PLATFORM_POOL) private readonly pool: Pool) {}

  async findActive(keycloakSubject: string): Promise<{ id: string; role: StaffRole } | null> {
    return withTransaction(this.pool, async ({ db }) => {
      const [row] = await db
        .select({ id: platformUsers.id, role: platformUsers.role })
        .from(platformUsers)
        .where(
          and(eq(platformUsers.keycloakSub, keycloakSubject), eq(platformUsers.status, 'active')),
        );
      return row ?? null;
    });
  }

  async hasPermission(staffId: string, permission: string): Promise<boolean> {
    const role = await this.roles.getOrLoad(staffId, () =>
      withTransaction(this.pool, async ({ db }) => {
        const [row] = await db
          .select({ role: platformUsers.role })
          .from(platformUsers)
          .where(and(eq(platformUsers.id, staffId), eq(platformUsers.status, 'active')));
        return row?.role ?? null;
      }),
    );
    return role !== null && staffRoleAllows(role, permission);
  }
}
