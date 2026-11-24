import { describe, expect, it } from 'vitest';
import { emptySlotHints } from './empty-slot-hints';
import type { PortMark } from './connectors';

const mark = (
  x: number,
  y: number,
  side: PortMark['side'],
  state: PortMark['state'] = 'available',
) => ({ partInstanceId: 'p', x, y, side, kind: 'universal', state }) as PortMark;
const always = () => true;
const weapon = { id: 'weapon', partClass: 'WEAPON' };
const shield = { id: 'shield', partClass: 'DEFENSE' };

describe('emptySlotHints', () => {
  it('offers the cell next to a free port', () => {
    const hints = emptySlotHints({
      marks: [mark(0, 0, 'E')],
      occupied: new Set(['0,0']),
      inBounds: always,
      needs: [weapon],
    });
    expect(hints).toEqual([{ needId: 'weapon', x: 1, y: 0, side: 'E' }]);
  });

  it('skips a port whose neighbour is occupied and uses the next', () => {
    const hints = emptySlotHints({
      marks: [mark(0, 0, 'E'), mark(0, 0, 'S')],
      occupied: new Set(['0,0', '1,0']),
      inBounds: always,
      needs: [weapon],
    });
    expect(hints).toEqual([{ needId: 'weapon', x: 0, y: 1, side: 'S' }]);
  });

  it('skips connected marks and out of bounds cells', () => {
    const hints = emptySlotHints({
      marks: [mark(0, 0, 'E', 'connected'), mark(0, 0, 'N'), mark(0, 0, 'S')],
      occupied: new Set(['0,0']),
      inBounds: (_x, y) => y >= 0,
      needs: [weapon],
    });
    expect(hints).toEqual([{ needId: 'weapon', x: 0, y: 1, side: 'S' }]);
  });

  it('never gives two needs the same cell', () => {
    const hints = emptySlotHints({
      marks: [mark(0, 0, 'E'), mark(0, 0, 'E'), mark(0, 0, 'S')],
      occupied: new Set(['0,0']),
      inBounds: always,
      needs: [weapon, shield],
    });
    expect(hints.map((h) => `${h.x},${h.y}`)).toEqual(['1,0', '0,1']);
  });

  it('caps the count at max (3 by default)', () => {
    const marks = [mark(0, 0, 'E'), mark(0, 0, 'S'), mark(0, 0, 'N'), mark(0, 0, 'W')];
    const needs = ['a', 'b', 'c', 'd'].map((id) => ({ id, partClass: 'X' }));
    const input = { marks, occupied: new Set(['0,0']), inBounds: always, needs };
    expect(emptySlotHints(input)).toHaveLength(3);
    expect(emptySlotHints({ ...input, max: 1 })).toHaveLength(1);
  });

  it('is empty without marks or without needs', () => {
    expect(
      emptySlotHints({ marks: [], occupied: new Set(), inBounds: always, needs: [weapon] }),
    ).toEqual([]);
    expect(
      emptySlotHints({
        marks: [mark(0, 0, 'E')],
        occupied: new Set(),
        inBounds: always,
        needs: [],
      }),
    ).toEqual([]);
  });
});
