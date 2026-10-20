import { describe, expect, it } from 'vitest';
import { fuelStatus } from './fuel-status';

describe('fuelStatus', () => {
  it('is ok when the fuel aboard covers the trip', () => {
    expect(fuelStatus(200, 120, 300)).toMatchObject({ state: 'ok', missing: 0 });
    expect(fuelStatus(120, 120, 300)).toMatchObject({ state: 'ok', missing: 0 });
  });

  it('is short when the tank could hold the trip but the fuel aboard does not cover it', () => {
    expect(fuelStatus(75, 120, 300)).toMatchObject({ state: 'short', missing: 45 });
    expect(fuelStatus(0, 300, 300)).toMatchObject({ state: 'short', missing: 300 });
  });

  it('is tank when the trip needs more than the tank holds, whatever is aboard', () => {
    expect(fuelStatus(300, 800, 300)).toMatchObject({ state: 'tank', missing: 500 });
    expect(fuelStatus(10, 301, 300)).toMatchObject({ state: 'tank' });
  });

  it('the bar scale holds all three amounts', () => {
    expect(fuelStatus(75, 120, 300).scale).toBe(300);
    expect(fuelStatus(300, 800, 300).scale).toBe(800);
    expect(fuelStatus(0, 0, 0).scale).toBe(1);
  });

  it('rounds to whole units', () => {
    expect(fuelStatus(74.6, 119.4, 300)).toMatchObject({ have: 75, needed: 119, missing: 44 });
  });
});
