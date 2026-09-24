import { describe, expect, it } from '@jest/globals';
import { missionSeed } from '../../../src/missions/generator/mission.generator.js';

describe('S6.2 — mission seed derivation', () => {
  it('encodes the (location, epoch, config version) triple', () => {
    expect(missionSeed({ locationId: 'ceres', epoch: 3, configVersion: 7 })).toBe('ceres|3|v7');
    expect(missionSeed({ locationId: 'ceres', epoch: 0, configVersion: 0 })).toBe('ceres|0|v0');
  });

  it('is deterministic and varies with every component', () => {
    const base = { locationId: 'ceres', epoch: 3, configVersion: 7 };
    expect(missionSeed(base)).toBe(missionSeed({ ...base }));
    expect(missionSeed({ ...base, locationId: 'vesta' })).not.toBe(missionSeed(base));
    expect(missionSeed({ ...base, epoch: 4 })).not.toBe(missionSeed(base));
    expect(missionSeed({ ...base, configVersion: 8 })).not.toBe(missionSeed(base));
  });
});
