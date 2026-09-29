/**
 * NestJS wiring for the audit service: which controllers and providers it has.
 *
 * Phase 1: empty. The audit table exists (see ../migrations) and every service writes to it
 * with recordAudit() from @eduplatform/server-kit.
 * Phase 2: adds the controller for GET /api/v1/audit/entries (docs/modules/audit.md).
 */
import { Module } from '@nestjs/common';

@Module({
  controllers: [],
  providers: [],
})
export class AuditModule {}
