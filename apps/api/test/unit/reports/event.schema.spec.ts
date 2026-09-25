import { describe, expect, it } from '@jest/globals';
import { ZodError } from 'zod';
import {
  UnsupportedMissionLogSchemaError,
  parseMissionLogEvents,
} from '../../../src/reports/events/event.schema.js';
import {
  MISSION_LOG_SCHEMA_VERSION,
  MISSION_EVENT_TYPES,
} from '../../../src/reports/events/event.types.js';
import {
  FAILURE_CONSEQUENCE,
  type FailureConsequence,
} from '../../../src/resolution/wear/failure.resolver.js';

/**
 * S9.1 — the closed report-event union:
 * - v2 (what resolve.service writes) is strict and integer-clean;
 * - v1 rows (pre-S9.0) stay readable, including their float magnitudes;
 * - unknown schemaVersions fail loudly;
 * - a valid v2 parse is value-identical (report replay identity).
 *
 * The category map below is written from the plan's frozen table on purpose:
 * a typo in the schema's map then fails here instead of silently agreeing
 * with itself.
 */

const CATEGORY: Record<(typeof MISSION_EVENT_TYPES)[number], string> = {
  leg_travel: 'transit',
  fuel_exhausted: 'transit',
  combat_win: 'combat',
  combat_loss: 'combat',
  escaped: 'combat',
  escort_absorbed: 'combat',
  escort_client_destroyed: 'failure',
  mission_wear: 'environment',
  mission_payout: 'payment',
  pvp_encounter: 'combat',
  mining: 'loot',
  mining_paid: 'payment',
  mining_partial_failure: 'payment',
  motor: 'failure',
  battery: 'failure',
  tank: 'failure',
  shield: 'failure',
  weapon: 'failure',
  sensor: 'failure',
};

const CASCADE_TYPES = ['combat_win', 'combat_loss', 'escort_absorbed'] as const;
const PART_FAILURE_TYPES = ['motor', 'battery', 'tank', 'shield', 'weapon', 'sensor'] as const;

function v2Event(
  type: (typeof MISSION_EVENT_TYPES)[number],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    leg: 0,
    category: CATEGORY[type],
    type,
    actors: { playerShipId: 'ship-a', clientShipId: 'ship-b' },
    effects: {
      hp: -3,
      condByPart: { hull: 91 },
      credits: 250,
      loot: [{ materialId: 'iron', quantity: 2 }],
    },
    magnitude: 250,
  };
  if ((CASCADE_TYPES as readonly string[]).includes(type)) {
    base['cascade'] = { shield: 4, armor: 6, hp: 3 };
  }
  if ((PART_FAILURE_TYPES as readonly string[]).includes(type)) {
    base['consequence'] = 'fuel_leak' satisfies FailureConsequence;
    if (type === 'tank') base['fuelLost'] = 12;
  }
  return { ...base, ...overrides };
}

describe('S9.1 — parseMissionLogEvents (closed union)', () => {
  it('parses every frozen type under its v2 shape, value-identically', () => {
    const events = MISSION_EVENT_TYPES.map((type) => v2Event(type));
    expect(parseMissionLogEvents(MISSION_LOG_SCHEMA_VERSION, events)).toEqual(events);
  });

  it('writes with schemaVersion 2 (D36)', () => {
    expect(MISSION_LOG_SCHEMA_VERSION).toBe(2);
  });

  describe('v2 strictness', () => {
    it('rejects a combat event without the S9.0 cascade', () => {
      const event = v2Event('combat_win');
      delete event['cascade'];
      expect(() => parseMissionLogEvents(2, [event])).toThrow(ZodError);
    });

    it('rejects a part-failure event without its consequence', () => {
      const event = v2Event('sensor');
      delete event['consequence'];
      expect(() => parseMissionLogEvents(2, [event])).toThrow(ZodError);
    });

    it('requires fuelLost on the tank failure (kept as a rounded integer)', () => {
      const event = v2Event('tank');
      delete event['fuelLost'];
      expect(() => parseMissionLogEvents(2, [event])).toThrow(ZodError);
      expect(() => parseMissionLogEvents(2, [v2Event('tank', { fuelLost: 12.5 })])).toThrow(
        ZodError,
      );
    });

    it('rejects a category that contradicts the frozen type', () => {
      expect(() => parseMissionLogEvents(2, [v2Event('combat_win', { category: 'loot' })])).toThrow(
        ZodError,
      );
    });

    it('rejects unknown keys on v2 rows', () => {
      expect(() => parseMissionLogEvents(2, [v2Event('leg_travel', { extra: 1 })])).toThrow(
        ZodError,
      );
      expect(() =>
        parseMissionLogEvents(2, [v2Event('escaped', { cascade: { shield: 0, armor: 0, hp: 0 } })]),
      ).toThrow(ZodError);
    });

    it('rejects non-integer numerics on v2 rows', () => {
      expect(() => parseMissionLogEvents(2, [v2Event('combat_loss', { magnitude: 5.5 })])).toThrow(
        ZodError,
      );
    });

    it('rejects unknown failure consequences', () => {
      expect(() =>
        parseMissionLogEvents(2, [v2Event('weapon', { consequence: 'engine_stalled' })]),
      ).toThrow(ZodError);
    });

    it('accepts every canonical consequence from the failure table', () => {
      for (const consequence of Object.values(FAILURE_CONSEQUENCE)) {
        const event = v2Event('motor', { consequence });
        expect(parseMissionLogEvents(2, [event])).toEqual([event]);
      }
    });

    it('rejects an unknown event type', () => {
      expect(() => parseMissionLogEvents(2, [v2Event('leg_travel', { type: 'hyperspace' })])).toThrow(
        ZodError,
      );
    });
  });

  describe('v1 backward read (D36)', () => {
    it('parses pre-S9.0 rows with float magnitudes untouched', () => {
      const legacy = [
        {
          leg: 0,
          category: 'combat',
          type: 'combat_win',
          actors: { playerShipId: 'ship-a', enemy: 'pirate' },
          effects: { hp: -12.5, condByPart: { hull: 88.75 }, credits: 0, loot: [] },
          magnitude: 5.6604273018892854,
        },
      ];
      expect(parseMissionLogEvents(1, legacy)).toEqual(legacy);
    });

    it('does not require v2 enrichment on v1 rows', () => {
      const legacy = [
        {
          leg: 0,
          category: 'failure',
          type: 'tank',
          actors: { playerShipId: 'ship-a' },
          effects: { hp: 0, condByPart: { tank: 2 }, credits: 0, loot: [] },
          magnitude: 1,
        },
      ];
      expect(parseMissionLogEvents(1, legacy)).toEqual(legacy);
    });

    it('still pins type/category consistency and closed membership', () => {
      expect(() =>
        parseMissionLogEvents(1, [
          {
            leg: 0,
            category: 'loot',
            type: 'combat_win',
            actors: { playerShipId: 's' },
            effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
            magnitude: 1,
          },
        ]),
      ).toThrow(ZodError);
      expect(() =>
        parseMissionLogEvents(1, [
          {
            leg: 0,
            category: 'transit',
            type: 'hyperspace',
            actors: { playerShipId: 's' },
            effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
            magnitude: 1,
          },
        ]),
      ).toThrow(ZodError);
    });
  });

  describe('unknown schema versions', () => {
    it.each([0, 3, 99])('throws UnsupportedMissionLogSchemaError for %i', (version) => {
      expect(() => parseMissionLogEvents(version, [])).toThrow(UnsupportedMissionLogSchemaError);
      try {
        parseMissionLogEvents(version, []);
      } catch (error) {
        expect((error as UnsupportedMissionLogSchemaError).schemaVersion).toBe(version);
        expect((error as Error).message).toContain('supported: 1, 2');
      }
    });
  });
});
