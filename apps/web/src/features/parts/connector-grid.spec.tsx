import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ConnectorGrid } from './connector-grid';
import { PartCard } from './part-card';
import type { PartInfoData } from './part-detail';

const cells = [
  { dx: 0, dy: 0, side: 'N', kind: 'central' },
  { dx: 0, dy: 0, side: 'E', kind: 'split' },
  { dx: 1, dy: 0, side: 'S', kind: 'universal' },
  { dx: 1, dy: 0, side: 'W', kind: 'none' },
] as const;

describe('ConnectorGrid', () => {
  it('draws one mark per non-none side, all in the available state', () => {
    const { container } = renderWithProviders(<ConnectorGrid w={2} h={1} connectors={cells} />);
    expect(screen.getAllByTestId('port-mark')).toHaveLength(3);
    expect(container.querySelectorAll('.conn-available')).toHaveLength(3);
    expect(container.querySelector('.conn-kind-split')).not.toBeNull();
    expect(container.querySelector('.conn-kind-universal')).not.toBeNull();
  });

  it('renders nothing for a part with no stored layout', () => {
    renderWithProviders(<ConnectorGrid w={1} h={1} connectors={[]} />);
    expect(screen.queryByTestId('connector-grid')).toBeNull();
  });
});

const part = (connectors: PartInfoData['connectors']): PartInfoData => ({
  displayName: { en: 'Cargo Rack', 'pt-BR': 'Suporte de Carga' },
  description: { en: 'd', 'pt-BR': 'd' },
  rarity: 'COMMON',
  catalog: {
    partType: 'cargo', partClass: 'CARGO', w: 2, h: 1, mass: 1, structureCost: 1, partHp: 1,
    basePrice: 1, pot: 0, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 1, min: 0, energyCont: 0,
    energyCombat: 0, fuelCap: 0, fuelUse: 0, batCharge: 0, batOutput: 0, batInput: 0,
    pressurized: false, lifeSupport: false,
  },
  connectors,
});

describe('PartCard before-buy ports', () => {
  it('shows the listing\'s generated ports on the card face', () => {
    renderWithProviders(<PartCard part={part([...cells])} price={10} />);
    expect(screen.getByTestId('connector-grid')).toBeInTheDocument();
  });

  it('shows no grid for a listing without a layout', () => {
    renderWithProviders(<PartCard part={part([])} price={10} />);
    expect(screen.queryByTestId('connector-grid')).toBeNull();
  });
});
