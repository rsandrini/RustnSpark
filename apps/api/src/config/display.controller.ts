import { Controller, Get } from '@nestjs/common';
import { GameConfigService } from './game-config.service.js';

/** What the player UI needs to show derived numbers the way the admin tuned them. */
export interface DisplayResponse {
  /** Multiplier for mobility and the speeds compared with it (see `ship.stat_display_scale`). */
  readonly statScale: number;
  /** pot / mass x this = unrounded mobility, the number the scale applies to. */
  readonly mobFactor: number;
  /** Share of the usual chance to find anything kept by a scavenger whose ship cannot fly. */
  readonly scavengeHandicap: number;
  /** Race overdrive: speed x, fuel x and the chance of overheating. */
  readonly overdrive: { readonly speed: number; readonly fuel: number; readonly risk: number };
}

@Controller('display')
export class DisplayController {
  constructor(private readonly config: GameConfigService) {}

  @Get()
  display(): DisplayResponse {
    const { ship, scavenging, race } = this.config.snapshot().rules;
    return {
      statScale: ship.stat_display_scale,
      mobFactor: ship.mob_factor,
      scavengeHandicap: scavenging.handicap_factor,
      overdrive: {
        speed: race.overdrive_speed,
        fuel: race.overdrive_fuel,
        risk: race.overdrive_risk,
      },
    };
  }
}
