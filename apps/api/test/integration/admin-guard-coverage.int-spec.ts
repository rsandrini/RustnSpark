import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { AdminGuard } from '../../src/admin/guards/admin.guard.js';
import { createTestApp, type TestApp } from '../support/app-factory.js';

type Ctor = { name: string; prototype: Record<string, unknown> };

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined) ?? [];
}

// Admin protection is opt-in per controller, so a new /admin controller that forgets
// @UseGuards(AdminGuard) would be reachable by any logged-in player. This fails the build instead.
describe('AdminGuard coverage', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp?.close();
  });

  it('every controller mounted under admin routes carries AdminGuard on the class or on every handler', () => {
    const modules = testApp.app.get(ModulesContainer);
    const adminControllers: Ctor[] = [];
    for (const moduleRef of modules.values()) {
      for (const wrapper of moduleRef.controllers.values()) {
        const ctor = wrapper.metatype as Ctor | null;
        if (!ctor) continue;
        const path = Reflect.getMetadata('path', ctor) as string | string[] | undefined;
        const paths = Array.isArray(path) ? path : [path ?? ''];
        if (paths.some((p) => p === 'admin' || p.startsWith('admin/'))) adminControllers.push(ctor);
      }
    }

    expect(adminControllers.length).toBeGreaterThanOrEqual(3);
    for (const ctor of adminControllers) {
      const classGuarded = guardsOf(ctor).includes(AdminGuard);
      if (classGuarded) continue;
      const handlers = Object.getOwnPropertyNames(ctor.prototype).filter(
        (name) => name !== 'constructor' && typeof ctor.prototype[name] === 'function',
      );
      for (const name of handlers) {
        const handler = ctor.prototype[name] as object;
        const isRoute = Reflect.getMetadata('path', handler) !== undefined;
        if (isRoute) {
          expect({
            controller: ctor.name,
            handler: name,
            guarded: guardsOf(handler).includes(AdminGuard),
          }).toEqual({
            controller: ctor.name,
            handler: name,
            guarded: true,
          });
        }
      }
    }
  });
});
