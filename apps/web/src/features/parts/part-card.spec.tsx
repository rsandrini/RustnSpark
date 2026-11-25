import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { PartCard } from './part-card';
import { partSummary } from './part-detail';
import i18n from '../../i18n';
import type { PartInfoData } from './part-detail';
import type { ConnectorCell } from '../../api/generated';
import type { PortFit } from './port-fit';

const catalog: PartInfoData['catalog'] = {
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
};

const cells: ConnectorCell[] = [
  { dx: 0, dy: 0, side: 'N', kind: 'central' },
  { dx: 1, dy: 0, side: 'N', kind: 'central' },
  { dx: 1, dy: 0, side: 'E', kind: 'split' },
];

const part = (connectors?: ConnectorCell[]): PartInfoData => ({
  displayName: { en: 'Cargo Rack', 'pt-BR': 'Suporte de Carga' },
  description: { en: 'A rack.', 'pt-BR': 'Um suporte.' },
  rarity: 'COMMON',
  catalog,
  condition: 100,
  connectors,
});

function renderCard(connectors: ConnectorCell[] | undefined, fit?: PortFit) {
  renderWithProviders(<PartCard part={part(connectors)} fit={fit} />);
}

describe('PartCard: ports first', () => {
  it('shows the large port diagram and the verdict but no port-words line', () => {
    renderCard(cells, { level: 'full', matching: 3, total: 3 });
    expect(screen.getByTestId('connector-grid')).toHaveClass('connector-grid-large');
    expect(screen.getByTestId('part-fit')).toBeInTheDocument();
    expect(screen.queryByTestId('part-ports')).toBeNull();
    expect(screen.queryByText(/North · 2 × Central connector/)).toBeNull();
  });

  it('draws the kind icon inside the large diagram and the art tile in the header', () => {
    renderCard(cells);
    expect(screen.getByTestId('connector-grid-kind')).toBeInTheDocument();
    expect(screen.getByTestId('part-art')).toHaveClass('part-art-72');
  });

  it('shows no diagram and no verdict for a part without connectors', () => {
    renderCard(undefined, { level: 'unknown' });
    expect(screen.queryByTestId('connector-grid')).toBeNull();
    expect(screen.queryByTestId('part-ports')).toBeNull();
    expect(screen.queryByTestId('part-fit')).toBeNull();
  });

  it('says how many of its ports match a free port (partial, ok tone)', () => {
    renderCard(cells, { level: 'partial', matching: 2, total: 3 });
    const fit = screen.getByTestId('part-fit');
    expect(fit).toHaveTextContent('2 of 3 ports match free ports on your ship');
    expect(fit).toHaveClass('ok');
  });

  it('says every port matches (full, ok tone)', () => {
    renderCard(cells, { level: 'full', matching: 3, total: 3 });
    const fit = screen.getByTestId('part-fit');
    expect(fit).toHaveTextContent('All ports match free ports on your ship');
    expect(fit).toHaveClass('ok');
  });

  it('names the reason when nothing joins (bad tone)', () => {
    renderCard(cells, { level: 'none', matching: 0, total: 3 });
    const fit = screen.getByTestId('part-fit');
    expect(fit).toHaveTextContent('No free port of your ship joins these ports');
    expect(fit).toHaveClass('bad');
  });

  it('says the ship has no free port', () => {
    renderCard(cells, { level: 'none-free' });
    const fit = screen.getByTestId('part-fit');
    expect(fit).toHaveTextContent('Your ship has no free port');
    expect(fit).toHaveClass('bad');
  });

  it('shows nothing about joining for no-ports, unknown or absent fit', () => {
    for (const fit of [{ level: 'no-ports' } as const, { level: 'unknown' } as const, undefined]) {
      const view = renderWithProviders(<PartCard part={part(cells)} fit={fit} />);
      expect(screen.queryByTestId('part-fit')).toBeNull();
      view.unmount();
    }
  });
});

describe('PartCard: no stat sentence', () => {
  it('lists no summary line (the stats live in the (i) popup and the hover card)', () => {
    const sentence = partSummary(
      catalog,
      (key) => i18n.t(key),
      (value) => String(value),
    );
    expect(sentence).not.toBe('');
    const { container } = renderWithProviders(<PartCard part={part()} />);
    expect(container.querySelector('.pcard-summary')).toBeNull();
    expect(container.textContent).not.toContain(sentence);
  });

  it('still shows the stats on the hover card', () => {
    const sentence = partSummary(
      catalog,
      (key) => i18n.t(key),
      (value) => String(value),
    );
    const label = sentence.split(' · ')[0]!.replace(/ \d+$/, '');
    const { container } = renderWithProviders(<PartCard part={part()} />);
    fireEvent.pointerEnter(container.querySelector('article')!, { clientX: 10, clientY: 10 });
    expect(screen.getByTestId('part-card-hover-card')).toHaveTextContent(label);
  });
});
