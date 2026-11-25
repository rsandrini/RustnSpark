import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { PartRow } from './part-row';
import { partSummary, type PartInfoData } from './part-detail';
import i18n from '../../i18n';

const part: PartInfoData = {
  displayName: { en: 'Cargo Rack', 'pt-BR': 'Suporte de Carga' },
  description: { en: 'A rack.', 'pt-BR': 'Um suporte.' },
  rarity: 'COMMON',
  catalog: {
    partType: 'cargo_uncommon',
    partClass: 'CARGO',
    w: 2,
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
    pax: 0,
    lifeCap: 0,
  },
  condition: 100,
};

const BUY = 'Buy';

describe('PartRow', () => {
  it('shows name, kind, size, fit chip, price, Buy and info, and no summary', () => {
    const { container } = renderWithProviders(
      <PartRow
        part={part}
        price={1200}
        fit={{ level: 'full', matching: 2, total: 2 }}
        actions={<button type="button">{BUY}</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Cargo Rack' })).toBeInTheDocument();
    expect(screen.getByTestId('part-art')).toHaveClass('part-art-40');
    expect(container.querySelector('.kind-tag')).not.toBeNull();
    expect(container).toHaveTextContent('2×1');
    expect(screen.getByTestId('part-fit')).toHaveClass('ok');
    expect(container).toHaveTextContent('1,200 ¢');
    expect(screen.getByRole('button', { name: 'Buy' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Details: Cargo Rack/ })).toBeInTheDocument();
    expect(container.querySelector('.pcard-summary')).toBeNull();
    expect(container.textContent).not.toContain(
      partSummary(
        part.catalog,
        (key) => i18n.t(key),
        (value) => String(value),
      ),
    );
    expect(screen.queryByTestId('part-ports')).toBeNull();
  });

  it('keeps the used tag, condition and broken tag', () => {
    renderWithProviders(<PartRow part={{ ...part, condition: 60, broken: true }} used />);
    expect(screen.getByText('Used')).toBeInTheDocument();
    expect(screen.getByText('BROKEN')).toBeInTheDocument();
    expect(screen.getByText(/60/)).toBeInTheDocument();
  });
});
