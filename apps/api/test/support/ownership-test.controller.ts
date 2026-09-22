import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../src/common/decorators/current-user.decorator.js';
import { OwnedResource } from '../../src/common/decorators/owned-resource.decorator.js';
import { OwnershipGuard } from '../../src/common/guards/ownership.guard.js';

// Test-only controller (never imported by AppModule): proves OwnershipGuard's 403/404 behaviour
// through a real Nest HTTP pipeline, since no real ownable domain (ships, missions) exists yet.
// The global JwtAuthGuard already runs for this route (registered as APP_GUARD); only
// OwnershipGuard needs @UseGuards() here.
@Controller('test/widgets')
export class OwnershipTestController {
  @Get(':id')
  @UseGuards(OwnershipGuard)
  @OwnedResource({ type: 'widget', param: 'id' })
  getWidget(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return { id, requestedBy: user.playerId };
  }
}
