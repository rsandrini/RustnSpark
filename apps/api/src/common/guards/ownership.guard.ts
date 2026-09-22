import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CurrentUserPayload } from '../decorators/current-user.decorator.js';
import {
  OWNED_RESOURCE_KEY,
  type OwnedResourceOptions,
} from '../decorators/owned-resource.decorator.js';
import { OwnershipResolverRegistry } from './ownership-resolver.registry.js';

// Applied per-route via @UseGuards(OwnershipGuard) wherever @OwnedResource({ type, param }) is
// declared (Step 4 ships, Step 6 missions, ...), never global. Runs after JwtAuthGuard, so
// request.user is already populated. A missing resolver for `type` is a programming error, not
// a 404/403: OwnershipResolverRegistry.resolve() throws for that case and this guard lets it
// propagate unchanged.
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly registry: OwnershipResolverRegistry,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<OwnedResourceOptions>(OWNED_RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) {
      throw new Error('OwnershipGuard applied to a route with no @OwnedResource() metadata');
    }

    const request = context
      .switchToHttp()
      .getRequest<{ params: Record<string, string>; user?: CurrentUserPayload }>();
    const resourceId = request.params[options.param];
    if (resourceId === undefined) {
      // The @OwnedResource() param name doesn't match any actual route param: a misconfiguration
      // of the route itself, not a runtime 404/403.
      throw new Error(
        `@OwnedResource() param "${options.param}" was not found on the request's route params`,
      );
    }
    if (!request.user) {
      // JwtAuthGuard (global) must have populated it first; missing means @Public() on an
      // @OwnedResource() route — a misconfiguration, not a 403.
      throw new Error(
        'OwnershipGuard ran without request.user: JwtAuthGuard must run before it (is this route @Public()?)',
      );
    }
    const resolver = this.registry.resolve(options.type);
    const owner = await resolver(resourceId);

    if (!owner) throw new NotFoundException('resource not found');
    if (owner.ownerPlayerId !== request.user.playerId) {
      throw new ForbiddenException('resource is owned by another player');
    }
    return true;
  }
}
