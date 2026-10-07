import { describe, expect, it } from '@jest/globals';
import { PARTS } from '../../prisma/seed-data/parts.js';
import {
  defaultConnectorRules,
  generateConnectors,
  parseConnectorRules,
  validateConnectorRules,
} from '../../src/parts/connector-rules.js';

describe('seeded connector rules', () => {
  it('every PARTS entry gets valid, generatable default rules', () => {
    for (const part of PARTS) {
      const rules = defaultConnectorRules(part.partClass);
      expect(parseConnectorRules(rules)).not.toBeNull();
      expect(validateConnectorRules(rules, part.partClass)).toBeNull();
      const layout = generateConnectors(rules, part.w, part.h, part.partType);
      expect(layout).not.toBeNull();
      for (const cell of layout!.cells) {
        expect(cell.dx).toBeGreaterThanOrEqual(0);
        expect(cell.dx).toBeLessThan(part.w);
        expect(cell.dy).toBeGreaterThanOrEqual(0);
        expect(cell.dy).toBeLessThan(part.h);
      }
    }
  });

  it('ENGINE/WEAPON have no W cells and every other perimeter side central; others all central', () => {
    for (const part of PARTS) {
      const layout = generateConnectors(defaultConnectorRules(part.partClass), part.w, part.h, 'x')!;
      const directional = part.partClass === 'ENGINE' || part.partClass === 'WEAPON';
      const sides = new Set(layout.cells.map((cell) => cell.side));
      expect(sides.has('W')).toBe(!directional);
      for (const side of ['N', 'E', 'S'] as const) expect(sides.has(side)).toBe(true);
      expect(layout.cells.every((cell) => cell.kind === 'central')).toBe(true);
      // perimeter edges: 2*(w + h) minus the W edge for directional parts
      const expected = directional ? 2 * part.w + part.h : 2 * (part.w + part.h);
      expect(layout.cells).toHaveLength(expected);
    }
  });
});
