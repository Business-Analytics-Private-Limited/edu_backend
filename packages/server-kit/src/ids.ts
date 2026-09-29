/**
 * Primary keys. Every table uses UUIDv7 ids generated here, never by the database
 * (CLAUDE.md rule 5, ADR-0005). UUIDv7 starts with a timestamp, so ids sort by creation time.
 */
import { v7 } from 'uuid';

/** New primary key: UUIDv7, time-ordered (ADR-0005). */
export function newId(): string {
  return v7();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
