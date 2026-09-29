/**
 * Service boundaries (ADR-0001, ADR-0011, CLAUDE.md rule 2).
 *
 * A service may use another service ONLY through '@eduplatform/<name>-service/public'.
 * If services reached into each other's internals, one could never be moved out into its
 * own microservice, so this is checked by a test rather than left to convention.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const servicesDir = resolve(__dirname, '..', '..', '..', '..', 'services');

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'node_modules' || name === 'dist' ? [] : listFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

/** Every import / require specifier in a file. */
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
const SERVICE_PACKAGE = /^@eduplatform\/([a-z-]+)-service(\/.*)?$/;

const services = readdirSync(servicesDir).filter((name) =>
  statSync(join(servicesDir, name)).isDirectory(),
);

describe('service boundaries', () => {
  it('finds the services', () => {
    expect(services).toContain('audit');
  });

  for (const service of services) {
    it(`${service}: uses other services only through their public interface`, () => {
      const root = join(servicesDir, service);
      const violations: string[] = [];
      for (const file of listFiles(join(root, 'src'))) {
        for (const [, specifier] of readFileSync(file, 'utf8').matchAll(IMPORT)) {
          if (!specifier) continue;
          const where = relative(servicesDir, file);

          // Relative imports must stay inside this service's folder.
          if (specifier.startsWith('.')) {
            const target = relative(root, resolve(dirname(file), specifier));
            if (target.startsWith('..') || target.split(sep)[0] === '..') {
              violations.push(`${where}: "${specifier}" leaves the service folder`);
            }
            continue;
          }

          // Another service's package: only its /public entry point.
          const match = SERVICE_PACKAGE.exec(specifier);
          if (match && match[1] !== service && match[2] !== '/public') {
            violations.push(`${where}: import "${specifier}/public" instead of "${specifier}"`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  }
});
