import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import { shipIdentityOf } from '../../../src/ships/ship-class.js';
import { EMPTY_SHEET } from './fixtures/empty-sheet.js';

const rules = GAME_CONFIG_DEFAULTS;

describe('shipIdentityOf (what every ship response carries next to the sheet)', () => {
  it('returns the class, the 7-axis profile and the modifier together', () => {
    const identity = shipIdentityOf(
      {
        ...EMPTY_SHEET,
        crg: rules.ship_profile.ref_cargo,
        pdf: rules.ship_profile.ref_firepower * 0.6,
      },
      rules,
    );
    expect(identity.shipClass).toBe('HAULER');
    expect(identity.profile.cargo).toBe(1);
    expect(identity.profile.firepower).toBeCloseTo(0.6);
    expect(identity.profileModifier).toBe('firepower');
  });

  it('names a weak ship BALANCED with no modifier', () => {
    expect(shipIdentityOf(EMPTY_SHEET, rules)).toMatchObject({
      shipClass: 'BALANCED',
      profileModifier: null,
    });
  });
});

describe('the old class model is gone', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return name === 'node_modules' || name === 'dist' ? [] : sources(path);
      }
      return /\.(ts|tsx|json)$/.test(name) ? [path] : [];
    });

  it.each([
    ['api src', join(root, 'src')],
    ['web src', join(root, '../web/src')],
  ])('no MULTIROLE or ship_class in %s', (_label, dir) => {
    const hits = sources(dir).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return text.includes('MULTIROLE') || text.includes('ship_class');
    });
    expect(hits).toEqual([]);
  });
});
