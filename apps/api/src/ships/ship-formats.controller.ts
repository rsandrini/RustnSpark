import { Controller, Get } from '@nestjs/common';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../common/decorators/current-user.decorator.js';
import { ShipsService } from './ships.service.js';

// Spec (2026-10-02-ship-format-design.md): GET /v1/ship-formats is its own top-level resource,
// not a sub-route of /v1/ships — a separate controller avoids any :id route-ordering concern
// ShipsController's own routes would otherwise have with a sibling 'formats' path segment.
@Controller('ship-formats')
export class ShipFormatsController {
  constructor(private readonly shipsService: ShipsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.shipsService.listFormats(user.playerId);
  }
}
