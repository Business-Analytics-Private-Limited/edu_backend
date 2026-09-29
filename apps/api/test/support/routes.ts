import 'reflect-metadata';
import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { readAccessDeclaration, type AccessDeclaration } from '@eduplatform/server-kit';

export interface Route {
  method: string;
  /** OpenAPI-style path relative to /api/v1, e.g. /students/students/{studentId} */
  path: string;
  controller: string;
  handler: string;
  access: AccessDeclaration;
}

/** A module class, or a dynamic module such as AppModule.forRoot(...). */
interface DynamicModuleRef {
  module: Type<unknown>;
  controllers?: Type<unknown>[];
  imports?: unknown[];
}
type ModuleRef = Type<unknown> | DynamicModuleRef;

function collectControllers(
  ref: ModuleRef | undefined,
  seen = new Set<unknown>(),
): Type<unknown>[] {
  if (!ref || seen.has(ref)) return [];
  seen.add(ref);
  const moduleClass = typeof ref === 'function' ? ref : ref.module;
  const dynamic: Partial<DynamicModuleRef> = typeof ref === 'function' ? {} : ref;
  const controllers: Type<unknown>[] = [
    ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass) as
      Type<unknown>[] | undefined) ?? []),
    ...(dynamic.controllers ?? []),
  ];
  const imports: ModuleRef[] = [
    ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) as ModuleRef[] | undefined) ??
      []),
    ...((dynamic.imports ?? []) as ModuleRef[]),
  ];
  return [...controllers, ...imports.flatMap((m) => collectControllers(m, seen))];
}

function joinPath(...parts: (string | string[] | undefined)[]): string {
  const segments = parts
    .flatMap((p) => (Array.isArray(p) ? p : [p]))
    .filter((p): p is string => Boolean(p))
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .map((s) => (s.startsWith(':') ? `{${s.slice(1)}}` : s));
  return '/' + segments.join('/');
}

/** Every HTTP route of an app module (static or dynamic), with its access declaration. */
export function collectRoutes(appModule: ModuleRef): Route[] {
  const routes: Route[] = [];
  for (const controller of collectControllers(appModule)) {
    const basePath = Reflect.getMetadata(PATH_METADATA, controller) as
      string | string[] | undefined;
    const prototype = controller.prototype as Record<string, unknown>;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const handler = prototype[name];
      if (name === 'constructor' || typeof handler !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
      if (method === undefined) continue;
      routes.push({
        method: RequestMethod[method].toLowerCase(),
        path: joinPath(basePath, Reflect.getMetadata(PATH_METADATA, handler) as string | undefined),
        controller: controller.name,
        handler: name,
        access: readAccessDeclaration(handler, controller),
      });
    }
  }
  return routes;
}
