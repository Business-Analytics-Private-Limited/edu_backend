import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listMigrationFiles } from './migrations';
import { ident } from './transaction';

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe('listMigrationFiles', () => {
  it('returns files in version order with checksums', () => {
    const dir = dirWith({ '0002_b.sql': 'select 2;', '0001_a.sql': 'select 1;' });
    const files = listMigrationFiles(dir);
    expect(files.map((f) => f.name)).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(files[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects badly named files', () => {
    const dir = dirWith({ 'create_students.sql': 'select 1;' });
    expect(() => listMigrationFiles(dir)).toThrow(/0001_name\.sql/);
  });
});

describe('ident', () => {
  it('quotes plain identifiers and rejects anything else', () => {
    expect(ident('students')).toBe('"students"');
    expect(() => ident('students; drop table x')).toThrow();
    expect(() => ident('Students')).toThrow();
  });
});
