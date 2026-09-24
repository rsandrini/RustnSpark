import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import { roundHalfEven } from '../../../src/resolution/numeric/round-half-even.js';

const oracleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/oracle',
);

interface TablesFixture {
  round_half_even: readonly (readonly [number, number])[];
}

function loadTables(): TablesFixture {
  return JSON.parse(readFileSync(path.join(oracleDir, 'tables.json'), 'utf8')) as TablesFixture;
}

describe('roundHalfEven', () => {
  it('matches the documented half-to-even cases', () => {
    expect(roundHalfEven(4.5)).toBe(4);
    expect(roundHalfEven(5.5)).toBe(6);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(7.5)).toBe(8);
    expect(roundHalfEven(10.5)).toBe(10);
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(4.4)).toBe(4);
    expect(roundHalfEven(4.6)).toBe(5);
  });

  it('matches the Python-generated 10,000-float oracle table exactly', () => {
    const cases = loadTables().round_half_even;
    expect(cases).toHaveLength(10_000);
    for (const [input, expected] of cases) {
      expect(roundHalfEven(input)).toBe(expected);
    }
  });
});
