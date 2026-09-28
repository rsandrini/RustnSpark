import { describe, expect, it } from '@jest/globals';
import { computeReportStats } from '../../../src/reports/report.stats.js';
import type { ReportLog } from '../../../src/reports/report.types.js';

const event = (over: Record<string, unknown>) =>
  ({
    leg: 0,
    category: 'combat',
    actors: { playerShipId: 's' },
    effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
    magnitude: 0,
    ...over,
  }) as never;

const log = (events: unknown[]): ReportLog => ({
  missionId: 'm',
  seed: 's',
  schemaVersion: 2,
  outcome: 'success',
  events: events as never,
  legs: [
    { index: 0, status: 'done' },
    { index: 1, status: 'done' },
  ],
  partTypeById: {},
  hasShield: true,
  partsBefore: [],
  credits: 250,
  balanceAfter: 450,
});

describe('computeReportStats', () => {
  it('sums the run: distance, fights, damage from fight-closing events only, loot and failures', () => {
    const stats = computeReportStats(
      log([
        event({ type: 'leg_travel', category: 'transit', magnitude: 400 }),
        event({ type: 'combat_win', cascade: { shield: 5, armor: 2, hp: 1 } }),
        // The escort's share repeats the fight's triple: it must not be counted again.
        event({ type: 'escort_absorbed', cascade: { shield: 5, armor: 2, hp: 1 } }),
        event({ type: 'combat_loss', cascade: { shield: 3, armor: 1, hp: 4 } }),
        event({ type: 'escaped' }),
        event({ type: 'tank', category: 'failure', fuelLost: 7 }),
        event({ type: 'motor', category: 'failure' }),
        event({
          type: 'mining',
          category: 'loot',
          effects: {
            hp: 0,
            condByPart: {},
            credits: 0,
            loot: [{ materialId: 'iron', quantity: 6 }],
          },
        }),
        event({
          type: 'mining',
          category: 'loot',
          effects: {
            hp: 0,
            condByPart: {},
            credits: 0,
            loot: [{ materialId: 'iron', quantity: 4 }],
          },
        }),
      ]),
      { parts: {}, materials: { iron: 'Iron' } },
    );
    expect(stats).toMatchObject({
      credits: 250,
      balanceAfter: 450,
      legs: 2,
      distance: 400,
      fights: { won: 1, lost: 1, escaped: 1, drawn: 0, pvp: 0 },
      damage: { shield: 8, armor: 3, hull: 5 },
      partFailures: 2,
      fuelLost: 7,
      found: [],
      loot: [{ materialId: 'iron', name: 'Iron', quantity: 10 }],
    });
  });

  it('is empty and zeroed for a quiet trip', () => {
    const stats = computeReportStats(log([]), { parts: {}, materials: {} });
    expect(stats.fights).toEqual({ won: 0, lost: 0, escaped: 0, drawn: 0, pvp: 0 });
    expect(stats.loot).toEqual([]);
  });

  it('passes hasShield through from the log unchanged', () => {
    expect(
      computeReportStats({ ...log([]), hasShield: true }, { parts: {}, materials: {} }),
    ).toMatchObject({ hasShield: true });
    expect(
      computeReportStats({ ...log([]), hasShield: false }, { parts: {}, materials: {} }),
    ).toMatchObject({ hasShield: false });
  });

  it("partsDamage reconstructs each part's dispatch-vs-final condition from condByPart, and skips parts that never changed", () => {
    const withParts: ReportLog = {
      ...log([
        event({
          type: 'mission_wear',
          category: 'environment',
          effects: { hp: 0, condByPart: { 'engine-1': 70, 'bridge-1': 99 }, credits: 0, loot: [] },
        }),
        event({
          type: 'combat_loss',
          cascade: { shield: 0, armor: 0, hp: 0 },
          effects: { hp: 0, condByPart: { 'engine-1': 55 }, credits: 0, loot: [] },
        }),
      ]),
      partsBefore: [
        { id: 'engine-1', partType: 'engine_chem_small', condition: 80 },
        { id: 'bridge-1', partType: 'bridge', condition: 100 },
        { id: 'cargo-1', partType: 'cargo', condition: 80 },
      ],
    };
    const stats = computeReportStats(withParts, {
      parts: { 'engine-1': { partType: 'engine_chem_small', name: 'Small Chem Engine' } },
      materials: {},
    });
    // engine-1: last condByPart entry wins (55, from the later combat_loss event) — a real drop.
    // bridge-1: only ticked from 100 to 99 — still a drop, still listed.
    // cargo-1: never appears in any condByPart — untouched, excluded from the table entirely.
    expect(stats.partsDamage).toEqual([
      {
        partId: 'engine-1',
        partType: 'engine_chem_small',
        name: 'Small Chem Engine',
        before: 80,
        after: 55,
      },
      { partId: 'bridge-1', partType: 'bridge', name: 'bridge', before: 100, after: 99 },
    ]);
  });
});
