import { describe, expect, it } from 'vitest';
import type { ConnectorCell, PartCatalogStats, Placement } from '../../api/generated';
import type { Kind, Side } from '../hangar/connectors';
import { freeShipPorts, portFit } from './port-fit';

const cell = (kind: Kind, side: Side = 'N', dx = 0, dy = 0): ConnectorCell => ({
  dx,
  dy,
  side,
  kind,
});

function catalog(w: number, h: number): PartCatalogStats {
  return {
    partType: 'x',
    partClass: 'UTILITY',
    w,
    h,
    mass: 1,
    structureCost: 1,
    partHp: 1,
    basePrice: 0,
    pot: 0,
    pdf: 0,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 0,
    min: 0,
    energyCont: 0,
    energyCombat: 0,
    fuelCap: 0,
    fuelUse: 0,
    batCharge: 0,
    batOutput: 0,
    batInput: 0,
    pressurized: false,
    lifeSupport: false,
  };
}

describe('portFit', () => {
  it('is unknown without data', () => {
    expect(portFit(undefined, ['central'])).toEqual({ level: 'unknown' });
    expect(portFit([], ['central'])).toEqual({ level: 'unknown' });
    expect(portFit([cell('central')], undefined)).toEqual({ level: 'unknown' });
  });

  it('is no-ports when the candidate has only none cells', () => {
    expect(portFit([cell('none'), cell('none', 'E')], ['central'])).toEqual({ level: 'no-ports' });
  });

  it('is none-free when the ship has no free ports', () => {
    expect(portFit([cell('central')], [])).toEqual({ level: 'none-free' });
  });

  it('is partial when only some candidate ports match', () => {
    expect(portFit([cell('central'), cell('split', 'E')], ['central'])).toEqual({
      level: 'partial',
      matching: 1,
      total: 2,
    });
  });

  it('is none when no candidate port matches', () => {
    expect(portFit([cell('split')], ['central'])).toEqual({
      level: 'none',
      matching: 0,
      total: 1,
    });
  });

  it('universal joins anything but none', () => {
    expect(portFit([cell('universal')], ['split'])).toEqual({
      level: 'full',
      matching: 1,
      total: 1,
    });
  });

  it('is kind-level: the number of free ports does not cap the count', () => {
    const three = [cell('central'), cell('central', 'E'), cell('central', 'S')];
    expect(portFit(three, ['central'])).toEqual({ level: 'full', matching: 3, total: 3 });
  });
});

describe('freeShipPorts', () => {
  it('returns only the kinds of available marks (a connected pair contributes none)', () => {
    const layout: Placement[] = [
      { partInstanceId: 'a', gx: 0, gy: 0, rot: 0 },
      { partInstanceId: 'b', gx: 1, gy: 0, rot: 0 },
    ];
    const catalogById = new Map([
      ['a', catalog(1, 1)],
      ['b', catalog(1, 1)],
    ]);
    const connectorsById = new Map<string, readonly ConnectorCell[]>([
      ['a', [cell('central', 'E'), cell('split', 'N')]],
      ['b', [cell('central', 'W'), cell('universal', 'S')]],
    ]);
    const free = freeShipPorts(layout, catalogById, connectorsById);
    expect([...(free ?? [])].sort()).toEqual(['split', 'universal']);
  });

  const one: Placement[] = [{ partInstanceId: 'a', gx: 0, gy: 0, rot: 0 }];
  const cat = new Map([['a', catalog(1, 1)]]);

  it('is undefined for an empty layout', () => {
    expect(freeShipPorts([], new Map(), new Map())).toBeUndefined();
  });

  it('is undefined when a placement has no catalog entry', () => {
    expect(freeShipPorts(one, new Map(), new Map([['a', [cell('central', 'E')]]]))).toBeUndefined();
  });

  it('is undefined for a legacy part with no stored connectors', () => {
    expect(freeShipPorts(one, cat, new Map([['a', []]]))).toBeUndefined();
    expect(freeShipPorts(one, cat, new Map())).toBeUndefined();
  });

  it('is [] for a known ship whose every port is connected (none-free stays true)', () => {
    const layout: Placement[] = [...one, { partInstanceId: 'b', gx: 1, gy: 0, rot: 0 }];
    const free = freeShipPorts(
      layout,
      new Map([
        ['a', catalog(1, 1)],
        ['b', catalog(1, 1)],
      ]),
      new Map<string, readonly ConnectorCell[]>([
        ['a', [cell('central', 'E')]],
        ['b', [cell('central', 'W')]],
      ]),
    );
    expect(free).toEqual([]);
    expect(portFit([cell('central')], free)).toEqual({ level: 'none-free' });
  });
});
