import { SetMetadata } from '@nestjs/common';

export interface OwnedResourceOptions {
  // Registry key: must match the `type` a resolver was registered under (OwnershipResolverRegistry).
  type: string;
  // Name of the route param holding the resource id (e.g. 'id' for a `:id` segment).
  param: string;
}

// OwnershipGuard reads this via Reflector, looks up a resolver for `type`, extracts the resource
// id from `request.params[param]`, and compares its owner against the current player.
export const OWNED_RESOURCE_KEY = 'ownedResource';

export const OwnedResource = (options: OwnedResourceOptions) =>
  SetMetadata(OWNED_RESOURCE_KEY, options);
