/**
 * Writes the audit log: who changed what, and when (CLAUDE.md rule 9).
 *
 * Call it inside the same database transaction as the change, so both are saved or neither:
 *
 *   await this.prisma.forOrganization(organizationId, async (db) => {
 *     const institution = await db.institution.create({ data });
 *     await this.audit.log(db, user, { action: 'create', entity: 'institution', entityId: institution.id });
 *   });
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrentUser } from '../../common/current-user';
import type { Db } from '../../prisma/prisma.service';

export interface AuditEntry {
  action: string; // "create", "update", "delete", "suspend", ...
  entity: string; // "organization", "institution", "user", ...
  entityId?: string;
  /** The organization the change belongs to. Defaults to the user's own organization. */
  organizationId?: string | null;
  /** Anything useful to understand the change later. Never passwords. */
  details?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  async log(db: Db, actor: CurrentUser, entry: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        organizationId:
          entry.organizationId !== undefined ? entry.organizationId : actor.organizationId,
        actorType: actor.type,
        actorId: actor.id,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        details: entry.details,
      },
    });
  }
}
