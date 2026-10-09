import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { fieldTypeOf } from '../../../src/economy/scavenging.service.js';

describe('S8.5 — field type (GDD §14 chance by field)', () => {
  it('maps a pirate-held debris field to the generous kind', () => {
    expect(fieldTypeOf({ type: 'scrap_field', factionId: 'pirates' })).toBe('pirate');
  });

  it('maps everything else (ports, friendly fields) to the common kind', () => {
    expect(fieldTypeOf({ type: 'scrap_field', factionId: 'luna' })).toBe('common');
    expect(fieldTypeOf({ type: 'port', factionId: 'luna' })).toBe('common');
    expect(fieldTypeOf({ type: 'dead_zone', factionId: 'pirates' })).toBe('common');
  });

  it('pins the configured numbers (chance per extra find, quality, timing)', () => {
    // Round-8 rebalance (owner: "the drop of items on scavenging is too high... investigate if
    // the quantity + price of items dropped is higher than doing quests"). The catalog's price
    // landscape grew a lot (RARE parts now average ~786¢, up from what this table was tuned
    // against); roughly halving both the extra-find chance and the found-condition range brings
    // scavenging back down from ~4x a mission's credits/minute toward parity.
    expect(GAME_CONFIG_DEFAULTS.scavenging.chance).toEqual({
      common: 0.12,
      mission: 0.27,
      pirate: 0.37,
    });
    expect(GAME_CONFIG_DEFAULTS.scavenging.quality_min).toBe(15);
    expect(GAME_CONFIG_DEFAULTS.scavenging.quality_max).toBe(40);
    expect(GAME_CONFIG_DEFAULTS.scavenging.cooldown_seconds).toBe(300);
    expect(GAME_CONFIG_DEFAULTS.scavenging.duration_seconds).toBe(600);
    expect(GAME_CONFIG_DEFAULTS.scavenging.foot_duration_seconds).toBe(300);
  });
});
