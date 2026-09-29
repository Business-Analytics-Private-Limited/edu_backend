import { describe, expect, it } from 'vitest';
import { isAccessDeclared } from '@eduplatform/server-kit';
import { AppModule } from '../../src/app.module';
import { loadOpenApiDocument } from '../../src/configure-app';
import { ALL_SERVICES } from '../../src/services';
import { collectRoutes } from '../support/routes';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options'] as const;

interface ContractOperation {
  operationId: string;
  'x-module'?: string;
  'x-permission'?: string;
  'x-planned'?: boolean;
}

const routes = collectRoutes(AppModule.forRoot(ALL_SERVICES));
const document = loadOpenApiDocument();
const operations = new Map<string, ContractOperation>();
for (const [path, item] of Object.entries(document.paths ?? {})) {
  for (const method of HTTP_METHODS) {
    const op = (item as Record<string, ContractOperation | undefined>)[method];
    if (op) operations.set(`${method} ${path}`, op);
  }
}

describe('every endpoint', () => {
  it('declares its guard (CLAUDE.md rule 3)', () => {
    expect(routes.map((r) => `${r.method} ${r.path}`)).toContain('get /health');
    const missing = routes
      .filter((r) => !isAccessDeclared(r.access))
      .map((r) => `${r.controller}.${r.handler} (${r.method.toUpperCase()} ${r.path})`);
    expect(
      missing,
      'add @RequireModule + @RequirePermission, or @Public / @AuthenticatedOnly',
    ).toEqual([]);
  });

  it('is documented in the OpenAPI contract (ADR-0010)', () => {
    const undocumented = routes
      .filter((r) => !operations.has(`${r.method} ${r.path}`))
      .map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(undocumented, 'add the operation to packages/contracts/openapi first').toEqual([]);
  });

  it('declares the same module and permission as its contract', () => {
    const mismatches: string[] = [];
    for (const route of routes) {
      const op = operations.get(`${route.method} ${route.path}`);
      if (!op) continue;
      const declared = route.access.mode ?? route.access.permission;
      if (op['x-permission'] !== declared) {
        mismatches.push(
          `${op.operationId}: contract x-permission=${op['x-permission']}, code=${declared}`,
        );
      }
      if (route.access.moduleKey && op['x-module'] !== route.access.moduleKey) {
        mismatches.push(
          `${op.operationId}: contract x-module=${op['x-module']}, code=${route.access.moduleKey}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('exists for every contract operation not marked x-planned', () => {
    const implemented = new Set(routes.map((r) => `${r.method} ${r.path}`));
    const missing = [...operations.entries()]
      .filter(([key, op]) => !op['x-planned'] && !implemented.has(key))
      .map(([key, op]) => `${op.operationId} (${key})`);
    expect(
      missing,
      'implement it, or mark it x-planned: true while the phase is in progress',
    ).toEqual([]);
  });
});
