import { describe, it, expect } from 'vitest';
import { MISSION_KINDS, SHIP_CLASSES, SHOWCASE } from './landing-content';

describe('landing content', () => {
  it('has five ship classes in the agreed order', () => {
    expect(SHIP_CLASSES).toEqual(['hauler', 'transport', 'warship', 'miner', 'multirole']);
  });

  it('has eight mission kinds, the first six board-started and the last two player-started', () => {
    expect(MISSION_KINDS).toHaveLength(8);
    expect(MISSION_KINDS.map((m) => m.id)).toEqual([
      'delivery',
      'transport',
      'escort',
      'mining',
      'rescue',
      'race',
      'scavenge',
      'travel',
    ]);
    expect(MISSION_KINDS.slice(0, 6).every((m) => m.start === 'board')).toBe(true);
    expect(MISSION_KINDS.slice(6).every((m) => m.start === 'own')).toBe(true);
  });

  it('pins every showcase inside the image with numbers 1, 2, 3', () => {
    for (const [id, showcase] of Object.entries(SHOWCASE)) {
      const numbers = showcase.pins.map((p) => p.n);
      expect(new Set(numbers)).toEqual(new Set([1, 2, 3]));
      for (const pin of showcase.pins) {
        expect(pin.left, `${id} pin ${pin.n} left`).toBeGreaterThanOrEqual(0);
        expect(pin.left, `${id} pin ${pin.n} left`).toBeLessThanOrEqual(100);
        expect(pin.top, `${id} pin ${pin.n} top`).toBeGreaterThanOrEqual(0);
        expect(pin.top, `${id} pin ${pin.n} top`).toBeLessThanOrEqual(100);
      }
    }
  });
});
