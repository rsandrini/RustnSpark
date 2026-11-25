import { describe, it, expect, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import i18n from '../../i18n';
import type { RankingEntry } from '../../api/generated';
import { podiumOf } from './podium';
import { OwnPlace, Podium } from './podium-view';

const entry = (rank: number, isMe = false): RankingEntry => ({
  rank,
  publicId: `pub${rank}`,
  name: `Pilot ${rank}`,
  factionId: null,
  value: 1000 - rank,
  isMe,
});
const valueText = (v: number) => `v${v}`;

function wrap(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Podium', () => {
  it('renders three columns in the order 2-1-3 with names, values and places', () => {
    wrap(
      <Podium podium={podiumOf([entry(1), entry(2), entry(3), entry(4)])} valueText={valueText} />,
    );
    const cols = within(screen.getByTestId('ranking-podium')).getAllByRole('listitem');
    expect(cols.map((c) => c.getAttribute('data-place'))).toEqual(['2', '1', '3']);
    expect(cols[1]).toHaveClass('podium-first');
    expect(within(cols[1]!).getByText('v999')).toBeInTheDocument();
    expect(cols[0]!.querySelector('.podium-pedestal')).toHaveTextContent('2');
    expect(screen.queryByText('Pilot 4')).not.toBeInTheDocument();
  });

  it('shows only the places that exist', () => {
    const { unmount } = wrap(
      <Podium podium={podiumOf([entry(1), entry(2)])} valueText={valueText} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    unmount();
    const one = wrap(<Podium podium={podiumOf([entry(1)])} valueText={valueText} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    one.unmount();
    const none = wrap(<Podium podium={podiumOf([])} valueText={valueText} />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it('links each name to the pilot card and highlights the own column', () => {
    wrap(<Podium podium={podiumOf([entry(1), entry(2, true), entry(3)])} valueText={valueText} />);
    expect(screen.getByRole('link', { name: 'Pilot 2' })).toHaveAttribute('href', '/pilots/pub2');
    expect(screen.getByRole('link', { name: 'Pilot 2' }).closest('li')).toHaveClass('me');
    expect(screen.getByRole('link', { name: 'Pilot 1' }).closest('li')).not.toHaveClass('me');
  });
});

describe('OwnPlace', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });
  const me = { rank: 14, value: 880 };

  it('says the rank and the gap to pass', () => {
    wrap(
      <OwnPlace
        me={me}
        board="distance"
        gap={{ kind: 'behind', amount: 120 }}
        valueText={valueText}
      />,
    );
    expect(screen.getByTestId('ranking-own')).toHaveTextContent(
      'You · rank 14 · +v120 to pass the next',
    );
  });

  it('phrases a race-time gap as time to shave', () => {
    wrap(
      <OwnPlace
        me={me}
        board="race_time"
        gap={{ kind: 'behind', amount: 7 }}
        valueText={valueText}
      />,
    );
    expect(screen.getByTestId('ranking-own')).toHaveTextContent('-v7 to pass the next');
  });

  it('covers first, tied, unknown and no result', () => {
    const a = wrap(
      <OwnPlace
        me={{ rank: 1, value: 5 }}
        board="distance"
        gap={{ kind: 'first' }}
        valueText={valueText}
      />,
    );
    expect(screen.getByTestId('ranking-own')).toHaveTextContent('You lead · rank 1');
    a.unmount();
    const b = wrap(
      <OwnPlace
        me={me}
        board="distance"
        gap={{ kind: 'behind', amount: 0 }}
        valueText={valueText}
      />,
    );
    expect(screen.getByTestId('ranking-own')).toHaveTextContent('Tied for the next place');
    b.unmount();
    const c = wrap(
      <OwnPlace me={me} board="distance" gap={{ kind: 'unknown' }} valueText={valueText} />,
    );
    expect(screen.getByTestId('ranking-own').textContent).toBe('You · rank 14');
    c.unmount();
    wrap(<OwnPlace me={null} board="distance" gap={{ kind: 'unknown' }} valueText={valueText} />);
    expect(screen.getByTestId('ranking-own')).toHaveTextContent(
      'You have no result on this board yet.',
    );
  });

  it('reads in Portuguese', async () => {
    await i18n.changeLanguage('pt-BR');
    wrap(
      <OwnPlace
        me={me}
        board="distance"
        gap={{ kind: 'behind', amount: 120 }}
        valueText={valueText}
      />,
    );
    expect(screen.getByTestId('ranking-own')).toHaveTextContent(
      'Você · posição 14 · +v120 para passar o próximo',
    );
  });
});
