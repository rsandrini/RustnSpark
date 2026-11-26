import { describe, it, expect } from 'vitest';
import { foldText, matchesPartSearch } from './part-search';

describe('matchesPartSearch', () => {
  it('ignores case and accents', () => {
    expect(foldText('Mineração')).toBe('mineracao');
    expect(matchesPartSearch('mineracao', ['Plataforma de Mineração'])).toBe(true);
    expect(matchesPartSearch('MOTOR quim', ['Motor Químico Aprimorado'])).toBe(true);
  });
  it('matches the type name as a text', () => {
    expect(matchesPartSearch('motor', ['Laser', 'Motor'])).toBe(true);
  });
  it('rejects a miss and accepts a blank needle', () => {
    expect(matchesPartSearch('tank', ['Laser'])).toBe(false);
    expect(matchesPartSearch('  ', ['x'])).toBe(true);
  });
});
