import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import { GAME_CONFIG_DEFAULTS } from '../../../src/config/game-config.defaults.js';
import type { GameRules } from '../../../src/config/game-config.types.js';
import {
  applyIntegrityLoss,
  combatIntegrityLoss,
  environmentIntegrityLoss,
  escortIntegrity,
  escortObjectStatus,
} from '../../../src/resolution/object/integrity.js';
import { INTEGRITY_CASES, PAYOUT_CASES } from '../../fixtures/appendix-e.js';

const oracleDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../fixtures/oracle',
);

interface TablesFixture {
  payout: { floor_integrity: number; table: [number, number][] };
}

const tables = JSON.parse(
  readFileSync(path.join(oracleDir, 'tables.json'), 'utf8'),
) as TablesFixture;

const rules: GameRules = GAME_CONFIG_DEFAULTS;

describe('S5.6 — object integrity', () => {
  it('every INTEGRITY_CASES combat row matches combat_factor × share × 100', () => {
    for (const c of INTEGRITY_CASES) {
      if (c.kind !== 'combat') continue;
      const loss = combatIntegrityLoss(c.maxHp, c.hpLost, rules);
      expect({ case: c, loss }).toEqual({
        case: c,
        loss: expect.closeTo(c.pointsLost, 12),
      });
    }
  });

  it('every INTEGRITY_CASES environment row matches env_factor × nivel', () => {
    for (const c of INTEGRITY_CASES) {
      if (c.kind !== 'environment') continue;
      const loss = environmentIntegrityLoss(c.envNivel, rules);
      expect({ case: c, loss }).toEqual({
        case: c,
        loss: expect.closeTo(c.pointsLost, 12),
      });
    }
  });

  it('every INTEGRITY_CASES escort row is the client HP share identity', () => {
    for (const c of INTEGRITY_CASES) {
      if (c.kind !== 'escort') continue;
      const integrity = escortIntegrity(c.clientHp, c.clientMaxHp);
      expect({ case: c, integrity }).toEqual({
        case: c,
        integrity: expect.closeTo(c.integrity, 12),
      });
    }
  });

  it('applyIntegrityLoss clamps to [0, 100]', () => {
    expect(applyIntegrityLoss(100, 30)).toBe(70);
    expect(applyIntegrityLoss(40, 50)).toBe(0);
    expect(applyIntegrityLoss(0, 10)).toBe(0);
    expect(applyIntegrityLoss(100, 0)).toBe(100);
  });

  it('escorted NPC below the payout floor pays zero; destroyed fails the mission', () => {
    expect(escortObjectStatus(60, 100, rules)).toBe('ok');
    expect(escortObjectStatus(50, 100, rules)).toBe('ok');
    expect(escortObjectStatus(49, 100, rules)).toBe('zero_payout');
    expect(escortObjectStatus(40, 100, rules)).toBe('zero_payout');
    expect(escortObjectStatus(25, 200, rules)).toBe('zero_payout');
    expect(escortObjectStatus(0, 100, rules)).toBe('destroyed');
    expect(escortObjectStatus(0, 200, rules)).toBe('destroyed');
    expect(rules.economy.payout_floor_integrity).toBe(0.5);
  });
});

describe('S5.6 — payout multiplier', () => {
  it('every PAYOUT_CASES row matches linear 100→50 and zero below the floor', () => {
    for (const c of PAYOUT_CASES) {
      const floorPoints = rules.economy.payout_floor_integrity * 100;
      const multiplier = c.integrity >= floorPoints ? c.integrity / 100 : 0;
      expect({ integrity: c.integrity, multiplier }).toEqual(c);
    }
  });

  it('matches the 101-row tables.json payout oracle', () => {
    expect(rules.economy.payout_floor_integrity * 100).toBe(tables.payout.floor_integrity);
    for (const [integrity, expected] of tables.payout.table) {
      const floorPoints = tables.payout.floor_integrity;
      const multiplier = integrity >= floorPoints ? integrity / 100 : 0;
      expect({ integrity, multiplier }).toEqual({
        integrity,
        multiplier: expect.closeTo(expected, 12),
      });
    }
  });
});
