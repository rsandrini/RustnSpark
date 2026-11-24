import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { TrayPartRow } from './tray-part-row';
import type { PortFit } from '../parts/port-fit';
import type { InventoryItem } from '../../api/generated';

const part = {
  id: 'p1',
  partType: 'cargo_uncommon',
  displayName: { en: 'Cargo Rack', 'pt-BR': 'Suporte de Carga' },
  description: { en: 'A rack.', 'pt-BR': 'Um suporte.' },
  rarity: 'COMMON',
  condition: 100,
  broken: false,
  catalog: {
    partType: 'cargo_uncommon',
    partClass: 'CARGO',
    w: 1,
    h: 1,
    mass: 2,
    structureCost: 4,
    partHp: 4,
    basePrice: 200,
    pot: 0,
    pdf: 0,
    bli: 0,
    esc: 0,
    sen: 0,
    crg: 8,
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
  },
  connectors: [{ dx: 0, dy: 0, side: 'N', kind: 'central' }],
} as unknown as InventoryItem;

function row(fit?: PortFit) {
  renderWithProviders(
    <TrayPartRow
      part={part}
      name="Hull"
      disabled={false}
      selected={false}
      onSelect={() => undefined}
      compare={undefined}
      fit={fit}
    />,
  );
}

describe('tray part row fit chip', () => {
  it('shows an ok chip with the count for a partial fit', () => {
    row({ level: 'partial', matching: 2, total: 3 });
    const chip = screen.getByTestId('tray-fit');
    expect(chip).toHaveClass('ok');
    expect(chip).toHaveTextContent('2');
    expect(chip).toHaveAccessibleName(/2 of 3/);
  });
  it('shows an ok chip for a full fit', () => {
    row({ level: 'full', matching: 3, total: 3 });
    expect(screen.getByTestId('tray-fit')).toHaveClass('ok');
  });
  it('shows a bad chip when nothing joins', () => {
    row({ level: 'none', matching: 0, total: 3 });
    expect(screen.getByTestId('tray-fit')).toHaveClass('bad');
    row({ level: 'none-free' });
    expect(screen.getAllByTestId('tray-fit')[1]).toHaveClass('bad');
  });
  it('shows nothing for unknown or absent', () => {
    row({ level: 'unknown' });
    row();
    row({ level: 'no-ports' });
    expect(screen.queryByTestId('tray-fit')).toBeNull();
  });
});
