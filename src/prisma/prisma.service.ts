/**
 * The database connection (Prisma) used by every service.
 *
 * Rows of an organization are protected twice:
 *   1. every query filters by organizationId (in the services), and
 *   2. PostgreSQL row security (see the first migration) hides other organizations' rows.
 *
 * For (2), PostgreSQL must know WHO is asking. That is what the two helpers below do; use one
 * of them for every query on organization data:
 *
 *   this.prisma.forOrganization(organizationId, (db) =>
 *     db.institution.findMany({ where: { organizationId } }),
 *   );
 *
 *   this.prisma.forAllOrganizations((db) => db.organization.findMany());   // super admin, login
 *
 * A query that uses neither sees no organization data at all: a safe failure, not a leak.
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** The database client inside forOrganization / forAllOrganizations. */
export type Db = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs `work` as a user of one organization: only that organization's rows are visible.
   * `timeoutMs`: for big jobs (e.g. importing students); the default limit is 5 seconds.
   */
  forOrganization<T>(
    organizationId: string,
    work: (db: Db) => Promise<T>,
    options: { timeoutMs?: number } = {},
  ): Promise<T> {
    return this.$transaction(
      async (db) => {
        // "true" = the setting lasts until the end of this transaction only.
        await db.$executeRaw`select set_config('app.organization_id', ${organizationId}, true)`;
        return work(db);
      },
      { timeout: options.timeoutMs ?? 5000, maxWait: 5000 },
    );
  }

  /** Runs `work` across all organizations. Only for super admin screens and login lookups. */
  forAllOrganizations<T>(work: (db: Db) => Promise<T>): Promise<T> {
    return this.$transaction(async (db) => {
      await db.$executeRaw`select set_config('app.bypass_rls', 'on', true)`;
      return work(db);
    });
  }
}
