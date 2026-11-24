import { describe, expect, it } from 'vitest';
import type { WorldLocation } from '../../api/generated';
import { labelFontSize, labelledFactions, territoriesOf, territoryLabelY } from './territories';

const place = (id: string, x: number, y: number, factionId: string): WorldLocation =>
  ({ id, x, y, factionId }) as WorldLocation;

describe('territoriesOf', () => {
  it('returns nothing for no places', () => {
    expect(territoriesOf([])).toEqual([]);
  });

  it('centres two places on their midpoint, radius half the distance plus the pad', () => {
    const [t] = territoriesOf([place('a', 0, 0, 'luna'), place('b', 100, 0, 'luna')]);
    expect(t).toEqual({ factionId: 'luna', cx: 50, cy: 0, radius: 90, placeIds: ['a', 'b'] });
  });

  it('gives a lone place the minimum radius', () => {
    const [t] = territoriesOf([place('a', 10, 20, 'sun')]);
    expect(t).toMatchObject({ cx: 10, cy: 20, radius: 60 });
  });

  it('honours custom pad and minRadius', () => {
    const [t] = territoriesOf([place('a', 0, 0, 'sun'), place('b', 100, 0, 'sun')], {
      pad: 10,
      minRadius: 500,
    });
    expect(t?.radius).toBe(500);
    const [u] = territoriesOf([place('a', 0, 0, 'sun'), place('b', 100, 0, 'sun')], {
      pad: 10,
      minRadius: 5,
    });
    expect(u?.radius).toBe(60);
  });

  it('excludes independent places (the "free" faction id; empty too)', () => {
    const out = territoriesOf([
      place('a', 0, 0, 'free'),
      place('b', 5, 5, ''),
      place('c', 9, 9, 'independent'),
      place('d', 1, 1, 'luna'),
    ]);
    expect(out.map((t) => t.factionId)).toEqual(['luna']);
  });

  it('sorts by faction id regardless of input order', () => {
    const out = territoriesOf([
      place('a', 0, 0, 'sun'),
      place('b', 0, 0, 'explorers'),
      place('c', 0, 0, 'luna'),
    ]);
    expect(out.map((t) => t.factionId)).toEqual(['explorers', 'luna', 'sun']);
  });
});

describe('territory labels', () => {
  const territory = { cy: 100, radius: 50 };
  it('clamps the label y into the visible window and keeps it inside the circle when it can', () => {
    expect(territoryLabelY(territory, null, 1)).toBe(64);
    expect(territoryLabelY(territory, { y: 0 }, 1)).toBe(64);
    expect(territoryLabelY(territory, { y: 200 }, 2)).toBe(228);
  });
  it('keeps the label at least 9px tall on screen', () => {
    expect(labelFontSize(10, 0.5)).toBe(10);
    expect(labelFontSize(5, 2)).toBe(18);
    expect(labelFontSize(5, Infinity)).toBe(5);
    expect(labelFontSize(5, 0)).toBe(5);
  });
  it('on a phone at fit zoom labels only the territory with the ship or the selected place', () => {
    const list = [
      { factionId: 'luna', placeIds: ['a', 'b'] },
      { factionId: 'sun', placeIds: ['c'] },
      { factionId: 'pirates', placeIds: ['d'] },
    ];
    const base = { regionalZoom: 1.6 };
    expect([
      ...labelledFactions(list, { ...base, phone: true, zoom: 1, placeIds: ['a', 'c'] }),
    ]).toEqual(['luna', 'sun']);
    expect([
      ...labelledFactions(list, { ...base, phone: true, zoom: 1, placeIds: [null, undefined] }),
    ]).toEqual([]);
    expect(labelledFactions(list, { ...base, phone: true, zoom: 1.6, placeIds: [] }).size).toBe(3);
    expect(labelledFactions(list, { ...base, phone: false, zoom: 1, placeIds: [] }).size).toBe(3);
  });
});
