import { describe, expect, it } from 'vitest';
import { clientToCells, insideBox, movedPastThreshold, startsDrag } from './drag-geometry';

const box = { left: 100, top: 50, width: 400, height: 400 };
const view = { cx: 10, cy: 10, span: 20 };

describe('clientToCells', () => {
  it('maps the box corners to the view corners and its centre to the view centre', () => {
    expect(clientToCells(box, view, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(clientToCells(box, view, 500, 450)).toEqual({ x: 20, y: 20 });
    expect(clientToCells(box, view, 300, 250)).toEqual({ x: 10, y: 10 });
  });

  it('does not divide by zero on an empty box', () => {
    const point = clientToCells({ left: 0, top: 0, width: 0, height: 0 }, view, 5, 5);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe('insideBox', () => {
  it('is true on the edges and false just outside every one', () => {
    expect(insideBox(box, 100, 50)).toBe(true);
    expect(insideBox(box, 500, 450)).toBe(true);
    expect(insideBox(box, 99, 250)).toBe(false);
    expect(insideBox(box, 501, 250)).toBe(false);
    expect(insideBox(box, 300, 49)).toBe(false);
    expect(insideBox(box, 300, 451)).toBe(false);
  });
});

describe('movedPastThreshold', () => {
  it('is false at 5 px and true at 6 px, in any direction', () => {
    expect(movedPastThreshold(0, 0, 5, 0)).toBe(false);
    expect(movedPastThreshold(0, 0, 0, -5)).toBe(false);
    expect(movedPastThreshold(0, 0, 6, 0)).toBe(true);
    expect(movedPastThreshold(0, 0, 0, -6)).toBe(true);
    expect(movedPastThreshold(0, 0, 4, 4)).toBe(false);
    expect(movedPastThreshold(0, 0, 5, 5)).toBe(true);
  });
});

describe('startsDrag', () => {
  it('refuses a finger and a frozen ship; accepts a mouse, a pen and an unknown pointer (jsdom)', () => {
    expect(startsDrag('touch', true)).toBe(false);
    expect(startsDrag('mouse', false)).toBe(false);
    expect(startsDrag('mouse', true)).toBe(true);
    expect(startsDrag('pen', true)).toBe(true);
    expect(startsDrag('', true)).toBe(true);
  });
});
