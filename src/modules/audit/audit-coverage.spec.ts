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
  'auth/auth.service.ts :: updateAccount':
    'failed-login counter; the attempt is logged by the caller',
  'auth/auth.service.ts :: startSession': 'part of a login, which is logged',
  'files/files.service.ts :: save': 'called by documents upload, which logs',
  'academic/structure.service.ts :: ensurePresets':
    'built-in years of a new organization (logged with it) or the startup sync',
  'academic/structure.service.ts :: ensureChild': 'part of set groups / add stream, which log',
  'academic/structure.service.ts :: deleteIfEmpty': 'part of the deletes that call it, which log',
  'academic/structure.service.ts :: createWholeCourse':
    'part of add course / change course (years without specializations), which log',
  'academic/structure.service.ts :: setYears':
    'part of add / change course and add specialization, which log',
  'academic/structure.service.ts :: removeSubtree':
    'part of delete course, fewer years and the first specialization, which log',
  'academic/branch-groups.ts :: giveBranchAllGroups': 'part of adding a branch, which logs',
  'evaluation/exams.service.ts :: replaceSubjects': 'part of update exam, which logs',
  'evaluation/marks.service.ts :: writeMarks': 'part of save and upload marks, which log',
  'evaluation/grading-schemes.service.ts :: clearDefault':
    'part of create / update grading scheme, which log',
  'roles/predefined-roles.service.ts :: copyToOrganization': 'part of creating an organization',
  'roles/predefined-roles.service.ts :: ensureTemplates': 'startup sync of the code, no person',
  'students/admission-numbers.ts :: admissionNumberFor': 'part of admission / import, which log',
  'students/students.service.ts :: moveCurrent': 'part of section / branch change, which log',
  'students/placement.ts :: closePortalLogins': 'part of leaving / completing, which log',
  'students/guardians.service.ts :: link': 'called by admit and add guardian, which log',
  'students/guardians.service.ts :: clearPrimary': 'called by add / update guardian, which log',
};

const WRITE =
  /\b(db|tx|this\.prisma)\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/;
const LOGS = /audit\.log\(|this\.recordLogin\(/;
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
