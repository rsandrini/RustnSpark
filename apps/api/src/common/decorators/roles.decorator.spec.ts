import { describe, expect, it } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { Roles, ROLES_KEY } from './roles.decorator.js';

class TestController {
  @Roles('ADMIN')
  adminRoute(this: void): void {
    /* no-op */
  }

  @Roles('ADMIN', 'PLAYER')
  multiRoleRoute(this: void): void {
    /* no-op */
  }

  openRoute(this: void): void {
    /* no-op */
  }
}

describe('Roles decorator', () => {
  it('stores a single required role as an array', () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, TestController.prototype.adminRoute)).toEqual(['ADMIN']);
  });

  it('stores multiple required roles in declaration order', () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, TestController.prototype.multiRoleRoute)).toEqual([
      'ADMIN',
      'PLAYER',
    ]);
  });

  it('leaves an undecorated method without the metadata key', () => {
    const reflector = new Reflector();
    expect(reflector.get(ROLES_KEY, TestController.prototype.openRoute)).toBeUndefined();
  });
});
