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
    expect(GAME_CONFIG_DEFAULTS.scavenging.chance).toEqual({
      common: 0.25,
      mission: 0.55,
      pirate: 0.75,
    });
    expect(GAME_CONFIG_DEFAULTS.scavenging.quality_min).toBe(30);
    expect(GAME_CONFIG_DEFAULTS.scavenging.quality_max).toBe(70);
    expect(GAME_CONFIG_DEFAULTS.scavenging.cooldown_seconds).toBe(300);
    expect(GAME_CONFIG_DEFAULTS.scavenging.duration_seconds).toBe(300);
  });
});
