import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';

export interface RouteInfo {
  readonly method: string;
  /** Full path under the global prefix, e.g. `/v1/ships/:id/repair/start`. */
  readonly path: string;
  readonly controller: (abstract new (...args: never[]) => unknown) & { name: string };
  readonly handlerName: string;
  readonly handler: (...args: never[]) => unknown;
  /** Route params named in the path (`:id` → `id`). */
  readonly params: readonly string[];
  /** Declared type of the `@Body()` argument, when the handler has one. */
  readonly bodyType: unknown;
  readonly hasBody: boolean;
}

const METHOD_NAMES: Record<number, string> = {
  [RequestMethod.GET]: 'GET',
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
};

const ROUTE_ARG_BODY = 3; // RouteParamtypes.BODY

function join(...parts: string[]): string {
  const segments = parts.flatMap((part) => part.split('/')).filter((segment) => segment !== '');
  return `/${segments.join('/')}`;
}

function firstPath(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '';
}

/** Every HTTP route the application exposes, read from Nest's own decorator metadata. */
export function listRoutes(app: INestApplication, prefix = 'v1'): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as RouteInfo['controller'] | null;
      if (controller === null) continue;
      const base = firstPath(Reflect.getMetadata('path', controller));
      const proto = controller.prototype as Record<string, unknown>;
      for (const handlerName of Object.getOwnPropertyNames(proto)) {
        const handler = proto[handlerName];
        if (handlerName === 'constructor' || typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata('method', handler) as number | undefined;
        if (verb === undefined) continue;
        const sub = firstPath(Reflect.getMetadata('path', handler));
        const path = join(prefix, base, sub);
        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, handlerName) ??
          {}) as Record<string, { index: number }>;
        const bodyKey = Object.keys(args).find((key) => key.startsWith(`${ROUTE_ARG_BODY}:`));
        const paramTypes = (Reflect.getMetadata('design:paramtypes', proto, handlerName) ??
          []) as unknown[];
        routes.push({
          method: METHOD_NAMES[verb] ?? String(verb),
          path,
          controller,
          handlerName,
          handler: handler as RouteInfo['handler'],
          params: [...path.matchAll(/:(\w+)/g)].map((match) => match[1]!),
          hasBody: bodyKey !== undefined,
          bodyType: bodyKey === undefined ? undefined : paramTypes[args[bodyKey]!.index],
        });
      }
    }
  }
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}
