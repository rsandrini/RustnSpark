import { Module, type OnModuleInit } from '@nestjs/common';
import { OwnershipResolverRegistry } from '../../src/common/guards/ownership-resolver.registry.js';
import { OwnershipTestController } from './ownership-test.controller.js';
import { OwnershipTestFixtures } from './ownership-test.fixtures.js';

// Test-only wiring for the OwnershipGuard integration tests (S2.4's controller rulings): imported
// only by test/support/app-factory.ts's extraImports, never by the production AppModule. Mirrors
// exactly how a real domain module (Step 4 ships, Step 6 missions) registers a resolver: inject
// the global OwnershipResolverRegistry and call register() once, on module init.
@Module({
  controllers: [OwnershipTestController],
  providers: [OwnershipTestFixtures],
  exports: [OwnershipTestFixtures],
})
export class OwnershipTestModule implements OnModuleInit {
  constructor(
    private readonly registry: OwnershipResolverRegistry,
    private readonly fixtures: OwnershipTestFixtures,
  ) {}

  onModuleInit(): void {
    this.registry.register('widget', (resourceId) => {
      const ownerPlayerId = this.fixtures.findOwner(resourceId);
      return Promise.resolve(ownerPlayerId ? { ownerPlayerId } : null);
    });
  }
}
