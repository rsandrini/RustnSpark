import { Injectable } from '@nestjs/common';

// In-memory owner lookup for the ownership integration tests (no real ownable domain exists yet,
// per S2.4's controller rulings): tests seed it directly instead of needing a database table.
@Injectable()
export class OwnershipTestFixtures {
  private readonly owners = new Map<string, string>();

  setOwner(resourceId: string, ownerPlayerId: string): void {
    this.owners.set(resourceId, ownerPlayerId);
  }

  findOwner(resourceId: string): string | undefined {
    return this.owners.get(resourceId);
  }

  clear(): void {
    this.owners.clear();
  }
}
