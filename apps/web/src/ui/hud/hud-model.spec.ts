import { describe, it, expect } from 'vitest';
import type { ActiveMission, ShipResponse } from '../../api/generated';
import { hudModel } from './hud-model';

function ship(over: {
  fuel?: number;
  fuelCap?: number;
  fuelUse?: number;
  condition?: number;
  hold?: { used: number; capacity: number } | null;
  crg?: number;
}): ShipResponse {
  const hold = over.hold === undefined ? { used: 2, capacity: 10 } : over.hold;
  return {
    fuel: over.fuel ?? 30,
    sheet: {
      fuelCap: over.fuelCap ?? 40,
      fuelUse: over.fuelUse ?? 1,
      condition: over.condition ?? 80,
      crg: over.crg ?? 10,
    },
    ...(hold === null ? {} : { hold }),
  } as unknown as ShipResponse;
}

const accepted = (fuelNeeded: number) =>
  ({ status: 'ACCEPTED', info: { estimate: { fuelNeeded } } }) as unknown as ActiveMission;

describe('hudModel', () => {
  it('fuel is null for a ship whose engines burn no fuel', () => {
    expect(hudModel(ship({ fuelUse: 0 }), undefined).fuel).toBeNull();
  });

  it("reserve equals the accepted mission's fuelNeeded and is absent without one", () => {
    expect(hudModel(ship({}), accepted(12)).fuel?.reserve).toBe(12);
    expect(hudModel(ship({}), undefined).fuel?.reserve).toBeUndefined();
    expect(hudModel(ship({}), accepted(0)).fuel?.reserve).toBeUndefined();
  });

  it('tone bad when empty or at the reserve', () => {
    expect(hudModel(ship({ fuel: 0 }), undefined).fuel?.tone).toBe('bad');
    expect(hudModel(ship({ fuel: 12 }), accepted(12)).fuel?.tone).toBe('bad');
    expect(hudModel(ship({ fuel: 8 }), undefined).fuel?.tone).toBe('warn');
    expect(hudModel(ship({ fuel: 30 }), accepted(12)).fuel?.tone).toBe('ok');
  });

  it('no NaN or division by zero when max is 0', () => {
    const model = hudModel(ship({ fuel: 0, fuelCap: 0, crg: 0, hold: null }), undefined);
    expect(model.fuel).toBeNull();
    expect(model.cargo).toBeNull();
    expect(hudModel(ship({ fuelCap: 0, fuelUse: 1 }), undefined).fuel).toBeNull();
    expect(hudModel(ship({ crg: 0, hold: { used: 0, capacity: 0 } }), undefined).cargo).toBeNull();
    expect(JSON.stringify(model)).not.toContain('null,null');
    expect(Number.isNaN(model.hull?.value)).toBe(false);
  });

  it('cargo and hull null without a ship', () => {
    expect(hudModel(undefined, undefined)).toEqual({ fuel: null, hull: null, cargo: null });
  });

  it('cargo reads the hold and the hull reads the condition with the sheet tones', () => {
    const model = hudModel(ship({ condition: 55 }), undefined);
    expect(model.cargo).toEqual({ used: 2, max: 10 });
    expect(model.hull).toEqual({ value: 55, max: 100, tone: 'warn' });
    expect(hudModel(ship({ condition: 20 }), undefined).hull?.tone).toBe('bad');
  });
});
