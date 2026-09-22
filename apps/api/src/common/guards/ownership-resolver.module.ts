import { Global, Module } from '@nestjs/common';
import { OwnershipResolverRegistry } from './ownership-resolver.registry.js';

// Global (mirrors EnvModule/PrismaModule/RedisModule): every domain module (Step 4 ships,
// Step 6 missions, ...) injects the same OwnershipResolverRegistry instance to register its
// resolver, and OwnershipGuard (applied per-route wherever those modules use it) resolves
// against that same instance.
@Global()
@Module({
  providers: [OwnershipResolverRegistry],
  exports: [OwnershipResolverRegistry],
})
export class OwnershipResolverModule {}
