import { describe, expect, it } from '@jest/globals';
import { parseMissionLogEvents } from '../../../src/reports/events/event.schema.js';
import { renderLog } from '../../../src/reports/log.view.js';
import { renderNarrative } from '../../../src/reports/narrative.view.js';
import { endPhaseOf } from '../../../src/reports/report.phases.js';
import type { ReportLog } from '../../../src/reports/report.types.js';

const ACTORS = { playerShipId: 'own-ship-1' };
const NAMES = {
  parts: {},
  materials: {},
  places: { origin: 'Ceres Station', destination: 'Hedus Yards' },
};
const raw = (leg: number): Record<string, unknown> => ({
  leg,
  category: 'transit',
  type: 'leg_travel',
  actors: ACTORS,
  effects: { hp: 0, condByPart: {}, credits: 0, loot: [] },
  magnitude: 300,
});
const log = (outcome: string, statuses: string[]): ReportLog => ({
  missionId: 'm-phase',
  seed: 'phase-seed',
  schemaVersion: 2,
  outcome,
  events: parseMissionLogEvents(
    2,
    statuses.map((_, leg) => raw(leg)),
  ),
  legs: statuses.map((status, index) => ({ index, status })),
  partTypeById: {},
  hasShield: false,
  partsBefore: [],
  credits: 0,
});

describe('the phases of a mission in the story and the log', () => {
  it('opens the first chapter with the departure and closes the last with the arrival', () => {
    const chapters = renderNarrative(log('success', ['completed', 'completed']), 'en', NAMES);
    const first = chapters[0]!.lines;
    const last = chapters.at(-1)!.lines;
    expect(first[0]!.type).toBe('phase_departure');
    expect(first[0]!.text).toContain('Ceres Station');
    expect(last.at(-1)!.type).toBe('phase_arrival');
    expect(last.at(-1)!.text).toContain('Hedus Yards');
    expect(chapters[0]!.lines.filter((line) => line.type.startsWith('phase_'))).toHaveLength(1);
  });

  it('puts the departure first and the ending last in the log', () => {
    const lines = renderLog(log('success', ['completed', 'completed']), 'pt-BR', NAMES);
    expect(lines[0]!.type).toBe('phase_departure');
    expect(lines.at(-1)!.type).toBe('phase_arrival');
    expect(lines).toHaveLength(4);
  });

  it('ends with the right phase for how the mission ended', () => {
    expect(endPhaseOf(log('failed', ['completed', 'motor_abort']))).toBe('phase_aborted');
    expect(endPhaseOf(log('adrift', ['adrift']))).toBe('phase_adrift');
    expect(endPhaseOf(log('success', ['completed']))).toBe('phase_arrival');
  });

  it('draws no phase lines when the places are not known, and reads the same every time', () => {
    const bare = renderNarrative(log('success', ['completed']), 'en', { parts: {}, materials: {} });
    expect(bare[0]!.lines.some((line) => line.type.startsWith('phase_'))).toBe(false);
    const a = renderNarrative(log('success', ['completed']), 'en', NAMES);
    const b = renderNarrative(log('success', ['completed']), 'en', NAMES);
    expect(a).toEqual(b);
  });
});
