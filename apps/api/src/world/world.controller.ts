import { Controller, Get } from '@nestjs/common';
import { WorldService } from './world.service.js';

// Default-deny (R28): no @Public(), the player comes from token claims. Path is
// relative to the global `v1` prefix (main.ts).
@Controller()
export class WorldController {
  constructor(private readonly world: WorldService) {}

  @Get('locations')
  getWorld() {
    return this.world.getWorld();
  }
}
