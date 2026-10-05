/**
 * THE AUDIT LOG IS MANDATORY (ADR-0027). This test reads the source code: every method in
 * src/modules that changes data (db.<table>.create / update / upsert / delete ...) must also
 * write an audit entry (this.audit.log, or a helper that calls it).
 *
 * If this test fails for your new method: add `await this.audit.log(db, actor, { ... })` in the
 * same transaction as the change. Only a HELPER that is called by a method which already logs
 * may go on the list below, with the reason.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const MODULES = join(__dirname, '..');

/** "file :: method" -> why it doesn't log itself. */
const ALLOWED: Record<string, string> = {
  'audit/audit.service.ts :: log': 'it IS the audit log',
  'files/files.service.ts :: save': 'called by documents upload, which logs',
  'organization/institution-records.ts :: addInstitution': 'callers (super admin) log',
  'organization/institution-records.ts :: deleteEmptyInstitution': 'callers (super admin) log',
  'roles/predefined-roles.service.ts :: copyToOrganization': 'part of creating an organization',
  'roles/predefined-roles.service.ts :: ensureTemplates': 'startup sync of the code, no person',
  'students/admission-numbers.ts :: nextAdmissionNo': 'part of admission / import, which log',
  'students/guardians.service.ts :: link': 'called by admit and add guardian, which log',
  'students/guardians.service.ts :: clearPrimary': 'called by add / update guardian, which log',
};

const WRITE =
  /\b(db|tx|this\.prisma)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
const LOGS = /audit\.log\(|this\.(logInstitution|recordLogin)\(/;
/** Where a method (2-space indented) or an exported function starts. */
const METHOD_START =
  /\n(?= {2}(?:(?:private|public|protected|async) )*\w+\(|export (?:async )?function )/;
const NAME = /^\s*(?:export )?(?:(?:private|public|protected|async) )*(?:function )?(\w+)\(/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'dto' ? [] : sourceFiles(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

/** Every "file :: method" that changes data, and whether it logs. */
function writingMethods(): { key: string; logs: boolean }[] {
  return sourceFiles(MODULES).flatMap((file) => {
    const shortName = relative(MODULES, file).replace(/\\/g, '/');
    return readFileSync(file, 'utf8')
      .split(METHOD_START)
      .filter((part) => WRITE.test(part))
      .map((part) => ({
        key: `${shortName} :: ${NAME.exec(part)?.[1] ?? '?'}`,
        logs: LOGS.test(part),
      }));
  });
}

describe('The audit log is mandatory', () => {
  const methods = writingMethods();

  it('finds the methods that change data', () => {
    expect(methods.length).toBeGreaterThan(50);
  });

  it('every method that changes data writes an audit entry', () => {
    const missing = methods.filter((m) => !m.logs && !(m.key in ALLOWED)).map((m) => m.key);
    expect(missing).toEqual([]);
  });

  it('the list of exceptions has no stale entries', () => {
    const found = new Set(methods.map((m) => m.key));
    expect(Object.keys(ALLOWED).filter((key) => !found.has(key))).toEqual([]);
  });
});
