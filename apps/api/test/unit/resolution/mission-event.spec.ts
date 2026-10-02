import { describe, it, expect } from '@jest/globals';
import { missionEvent } from '../../../src/resolution/events/mission-event.js';

describe('missionEvent', () => {
  it('preserves pdf and bonus inside combat rounds so the report can show the full roll breakdown', () => {
    const event = missionEvent({
      leg: 0,
      category: 'combat',
      type: 'combat_win',
      actors: { playerShipId: 'ship-1' },
      rounds: [
        {
          round: 1,
          attacker: 'enemy',
          roll: 10,
          pdf: 4,
          bonus: 2,
          dc: 13,
          hit: true,
          damage: 5,
          armorAbsorbed: 1,
          shieldAbsorbed: 0,
          hullDamage: 4,
        },
        {
          round: 2,
          attacker: 'player',
          roll: 8,
          pdf: 3,
          dc: 12,
          hit: false,
          damage: 0,
          armorAbsorbed: 0,
          shieldAbsorbed: 0,
          hullDamage: 0,
        },
      ],
    });

    expect(event.rounds).toHaveLength(2);
    expect(event.rounds?.[0]).toMatchObject({ roll: 10, pdf: 4, bonus: 2, dc: 13 });
    expect(event.rounds?.[1]).toMatchObject({ roll: 8, pdf: 3, dc: 12 });
    expect(event.rounds?.[1]?.bonus).toBeUndefined();
  });
});
