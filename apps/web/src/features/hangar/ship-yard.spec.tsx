import { describe, it, expect } from 'vitest';
import type { ConnectorCell, PartCatalogStats } from '../../api/generated';
import { renderWithProviders } from '../../test/utils';
import { ShipYard, labelAreaFactor, labelLines } from './ship-yard';

describe('labelAreaFactor', () => {
  it('is 1 at and below the classic_square baseline (20×20 = 400 cells) — never scales up', () => {
    expect(labelAreaFactor(400)).toBe(1);
    expect(labelAreaFactor(25)).toBe(1);
    expect(labelAreaFactor(1)).toBe(1);
  });

  it('shrinks the label on a larger yard', () => {
    expect(labelAreaFactor(961)).toBeLessThan(1); // 31×31
  });

  it('clamps extreme formats', () => {
    expect(labelAreaFactor(100000)).toBe(0.5); // min shrink
  });
});

describe('labelLines', () => {
  it('wraps the name into block-sized lines on a single cell at the default zoom', () => {
    const lines = labelLines('Small Chemical Engine', 1, 1, 1);
    expect(lines.join(' ')).toBe('Small Chemical Engine');
    expect(lines.length).toBeGreaterThan(0);
    // Capacity at the current font: floor(0.85 * 4.3 * 0.42 / 0.16) = 9 chars per line.
    expect(lines.every((line) => line.length <= 9)).toBe(true);
  });

  it('fits the whole name on one line once the player zooms in', () => {
    const lines = labelLines('Small Chemical Engine', 1, 1, 3);
    expect(lines.join(' ')).toBe('Small Chemical Engine');
    expect(lines).toHaveLength(1);
  });

  it('fits a wide block on a single line', () => {
    expect(labelLines('Hull Frame', 4, 1, 1)).toEqual(['Hull Frame']);
  });

  it('fits more of the name when the yard area shrinks the font (areaFactor < 1)', () => {
    const atBaseline = labelLines('Small Chemical Engine', 1, 1, 1, 1);
    const onBigYard = labelLines('Small Chemical Engine', 1, 1, 1, 0.65);
    expect(onBigYard.join(' ').length).toBeGreaterThanOrEqual(atBaseline.join(' ').length);
  });
});

describe('ShipYard port marks', () => {
  const one: PartCatalogStats = {
    partType: 'x', partClass: 'UTILITY', w: 1, h: 1, mass: 1, structureCost: 1, partHp: 1,
    basePrice: 0, pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 0, min: 0, energyCont: 0,
    energyCombat: 0, fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0,
    pressurized: false, lifeSupport: false,
  };
  const baseProps = {
    cells: [[0, 0], [1, 0], [2, 0]] as [number, number][],
    catalogById: new Map([['a', one], ['b', one]]),
    nameById: new Map([['a', 'A'], ['b', 'B']]),
    selectedId: null,
    draggingId: null,
    onSelect: () => undefined,
    onCellClick: () => undefined,
    onCellHover: () => undefined,
    onDragStart: () => undefined,
    onDragEnd: () => undefined,
  };

  it('draws green/red/blue marks for connected, incompatible and free ports; legacy parts draw none', () => {
    const { container } = renderWithProviders(
      <ShipYard
        {...baseProps}
        layout={[
          { partInstanceId: 'a', gx: 0, gy: 0, rot: 0 },
          { partInstanceId: 'b', gx: 1, gy: 0, rot: 0 },
        ]}
        connectorsById={
          new Map<string, ConnectorCell[]>([
            ['a', [{ dx: 0, dy: 0, side: 'E', kind: 'central' }, { dx: 0, dy: 0, side: 'N', kind: 'central' }]],
            ['b', [{ dx: 0, dy: 0, side: 'W', kind: 'split' }]],
          ])
        }
      />,
    );
    expect(container.querySelectorAll('.conn-incorrect')).toHaveLength(2); // a.E <-> b.W mismatch
    expect(container.querySelectorAll('.conn-available')).toHaveLength(1); // a.N
    expect(container.querySelectorAll('.conn-connected')).toHaveLength(0);
  });

  it('draws nothing for parts without stored connectors', () => {
    const { container } = renderWithProviders(
      <ShipYard
        {...baseProps}
        layout={[{ partInstanceId: 'a', gx: 0, gy: 0, rot: 0 }]}
        connectorsById={new Map<string, ConnectorCell[]>([['a', []]])}
      />,
    );
    expect(container.querySelectorAll('[data-testid="port-mark"]')).toHaveLength(0);
  });
});
