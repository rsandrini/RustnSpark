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

  it('ENGINE/WEAPON never get a W port; every part carries ONE kind and at least one port; bare sides, and all three kinds, occur across the catalog', () => {
    const seen = new Set<string>();
    let bareSides = 0;
    for (const part of PARTS) {
      const layout = generateConnectors(defaultConnectorRules(part.partClass), part.w, part.h, part.partType)!;
      const directional = part.partClass === 'ENGINE' || part.partClass === 'WEAPON';
      const sides = new Set(layout.cells.map((cell) => cell.side));
      if (directional) expect(sides.has('W')).toBe(false);
      expect(layout.cells.length).toBeGreaterThanOrEqual(1);
      const kinds = new Set(layout.cells.map((cell) => cell.kind));
      expect(kinds.size).toBe(1); // one kind per part, same ports on every side
      kinds.forEach((kind) => seen.add(kind));
      bareSides += 4 - sides.size;
    }
    expect([...seen].sort()).toEqual(['central', 'split', 'universal']);
    expect(bareSides).toBeGreaterThan(0); // not every side carries a port
  });
});
