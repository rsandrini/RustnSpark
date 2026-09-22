import { describe, expect, it } from '@jest/globals';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OwnershipResolverModule } from './ownership-resolver.module.js';
import { OwnershipResolverRegistry } from './ownership-resolver.registry.js';

@Injectable()
class Consumer {
  constructor(readonly registry: OwnershipResolverRegistry) {}
}

// Deliberately does not import OwnershipResolverModule: the global module must be enough.
@Module({ providers: [Consumer] })
class ConsumerModule {}

describe('OwnershipResolverModule', () => {
  it('is global: other modules inject OwnershipResolverRegistry without importing it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OwnershipResolverModule, ConsumerModule],
    }).compile();

    expect(moduleRef.get(Consumer).registry).toBe(moduleRef.get(OwnershipResolverRegistry));
  });
});
