/**
 * The build archetype decides what the ship grows into between flights: legacy chemical kit,
 * chemical + shield, or an ion drive + shield. Pins the buy order and the matrix naming.
 */
import { describe, expect, it } from '@jest/globals';
import {
  archetypeOf,
  priorityBasesOf,
  usesChemEngine,
} from '../../../sim/bots/archetype.js';
import { kitBasesOf } from '../../../sim/bots/policy.js';
import { archetypeMatrix, cellName, defaultMatrix } from '../../../sim/experiment/cells.js';

describe('archetype', () => {
  it('reads known names and falls back to the legacy kit', () => {
    expect(archetypeOf('ion-shield')).toBe('ion-shield');
    expect(archetypeOf('chem-shield')).toBe('chem-shield');
    expect(archetypeOf('whatever')).toBe('chem');
  });

  it('buys the ion drive and its power before the battery and shield', () => {
    expect(priorityBasesOf('chem')).toEqual([]);
    expect(priorityBasesOf('ion-shield')).toEqual([
      'reactor_solar',
      'engine_ion_micro',
      'battery_small',
      'shield_basic',
    ]);
  });

  it('drops chemical engines and tanks from the ion kit only', () => {
    expect(usesChemEngine('ion-shield')).toBe(false);
    expect(kitBasesOf('ion-shield').some((base) => /^(engine_chem|tank)/.test(base))).toBe(false);
    expect(kitBasesOf('chem-shield')).toContain('engine_chem_small');
    expect(kitBasesOf('ion-shield')).toContain('engine_ion_micro');
  });

  it('names legacy cells as before and tags the other builds', () => {
    const [first] = defaultMatrix(2);
    expect(first).toBeDefined();
    expect(cellName(first!)).toBe('greedy|generalist|2h');
    const ion = archetypeMatrix(2).find((cell) => cell.archetype === 'ion-shield');
    expect(cellName(ion!)).toMatch(/\|ion-shield$/);
    expect(archetypeMatrix(2)).toHaveLength(12);
  });
});
