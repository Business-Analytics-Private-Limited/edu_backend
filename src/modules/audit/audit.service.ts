/**
 * Writes the audit log: who changed what, and when (CLAUDE.md rule 9). It is MANDATORY for every
 * change (ADR-0027): audit-coverage.spec.ts fails when a method changes data without calling it.
 * The table is add-only: the app's database role can't change or delete entries.
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
import type { Db } from '../../prisma/prisma.service';

/**
 * Who did it. Usually the logged-in user (CurrentUser fits). For a login attempt it is the person
 * the email belongs to, or "unknown" with no id when the email belongs to nobody.
 */
export interface AuditActor {
  type: 'super_admin' | 'user' | 'unknown';
  id: string | null;
  name: string | null;
  organizationId: string | null;
}

export interface AuditEntry {
  action: string; // "create", "update", "delete", "suspend", ...
  entity: string; // "organization", "institution", "user", ...
  entityId?: string;
  /** The organization the change belongs to. Defaults to the user's own organization. */
  organizationId?: string | null;
  /**
   * Where in the organization it happened, if it belongs to one institution or campus.
   * Campus and institution admins see only the log of their own place.
   */
  institutionId?: string | null;
  campusId?: string | null;
  /** Anything useful to understand the change later. Never passwords. */
  details?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  async log(db: Db, actor: AuditActor, entry: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        organizationId:
          entry.organizationId !== undefined ? entry.organizationId : actor.organizationId,
        actorType: actor.type,
        actorId: actor.id,
        actorName: actor.name,
        institutionId: entry.institutionId ?? null,
        campusId: entry.campusId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        details: entry.details,
      },
    });
  }
}
