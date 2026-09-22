import { Injectable } from '@nestjs/common';

export interface OwnerLookupResult {
  ownerPlayerId: string;
}

// Resolves a resource id to its owning player, or null when the resource does not exist.
// One resolver per `type` (e.g. 'ship', 'mission'), registered by the domain module that owns
// that resource; OwnershipGuard looks resolvers up by type at request time.
export type OwnershipResolver = (resourceId: string) => Promise<OwnerLookupResult | null>;

// Thrown by resolve() when a route declares @OwnedResource({ type }) for a type nobody
// registered a resolver for. Always a programming error (a domain module forgot to register),
// never a runtime 404/403 — OwnershipGuard deliberately does not catch it.
export class OwnershipResolverNotFoundError extends Error {
  constructor(type: string) {
    super(
      `No ownership resolver registered for type "${type}". Register one via ` +
        'OwnershipResolverRegistry.register() from the module that owns this resource type.',
    );
    this.name = 'OwnershipResolverNotFoundError';
  }
}

// Thrown by register() when two modules try to own the same type: a silent overwrite would let
// one resolver shadow the other — the same class of programming error as a missing resolver.
export class OwnershipResolverAlreadyRegisteredError extends Error {
  constructor(type: string) {
    super(
      `An ownership resolver for type "${type}" is already registered. Two modules are ` +
        'registering the same type; exactly one resolver per type is allowed.',
    );
    this.name = 'OwnershipResolverAlreadyRegisteredError';
  }
}

// Empty in production until a domain module registers into it (Step 4 ships, Step 6 missions,
// ...). Application-wide singleton: OwnershipResolverModule exports this globally so every
// feature module sees the same instance OwnershipGuard resolves against.
@Injectable()
export class OwnershipResolverRegistry {
  private readonly resolvers = new Map<string, OwnershipResolver>();

  register(type: string, resolver: OwnershipResolver): void {
    if (this.resolvers.has(type)) throw new OwnershipResolverAlreadyRegisteredError(type);
    this.resolvers.set(type, resolver);
  }

  resolve(type: string): OwnershipResolver {
    const resolver = this.resolvers.get(type);
    if (!resolver) throw new OwnershipResolverNotFoundError(type);
    return resolver;
  }
}
