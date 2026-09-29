/**
 * Writing audit entries (CLAUDE.md rule 9). Call recordAudit() inside the same transaction
 * as every create, update or delete of business data. See services/audit/README.md.
 */
import { requireContext, requireTenantId } from '../context/request-context';
import type { Tx } from '../db/transaction';
import { newId } from '../ids';

type Row = Record<string, unknown>;

export interface AuditInput {
  moduleKey: string;
  /** `module.entity`, e.g. `students.student`. */
  entityType: string;
  entityId: string;
  /** create | update | delete | restore, or a domain verb such as promote or correct. */
  action: string;
  before?: Row | null;
  after?: Row | null;
  reason?: string;
}

export type AuditChanges = Record<string, [unknown, unknown]>;

/** Never recorded, whatever the entity. */
const SECRET_FIELD = /(password|secret|token|otp|hash)/i;
/** Bookkeeping fields that change on every write and add noise to the log. */
const IGNORED_FIELDS = new Set(['updatedAt', 'updated_at', 'updatedBy', 'updated_by', 'version']);

/** Field-level changes between two versions of an entity, with secrets redacted. */
export function diffForAudit(
  before: Row | null | undefined,
  after: Row | null | undefined,
): AuditChanges {
  const changes: AuditChanges = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (IGNORED_FIELDS.has(key)) continue;
    const from = before?.[key] ?? null;
    const to = after?.[key] ?? null;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[key] = SECRET_FIELD.test(key) ? ['[redacted]', '[redacted]'] : [from, to];
  }
  return changes;
}

/**
 * Writes an audit entry inside the caller's transaction (CLAUDE.md rule 9). If the entry
 * can't be written, the business change fails with it. Actor, tenant, request id and client
 * details come from the request context.
 */
export async function recordAudit(tx: Tx, input: AuditInput): Promise<void> {
  const context = requireContext();
  const changes = diffForAudit(input.before, input.after);
  await tx.client.query(
    `insert into audit.entries
       (id, tenant_id, occurred_at, actor_type, actor_id, impersonator_id, module_key,
        entity_type, entity_id, action, changes, reason, request_id, ip, user_agent)
     values ($1, $2, now(), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      newId(),
      requireTenantId(),
      context.actorType,
      context.userId ?? null,
      context.impersonatorId ?? null,
      input.moduleKey,
      input.entityType,
      input.entityId,
      input.action,
      JSON.stringify(changes),
      input.reason ?? null,
      context.requestId,
      context.ip ?? null,
      context.userAgent?.slice(0, 500) ?? null,
    ],
  );
}
