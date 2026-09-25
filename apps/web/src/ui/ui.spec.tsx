import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../test/utils';
import { ItemCard } from './ItemCard';
import { RiskBadge } from './RiskBadge';
import { FactionBadge } from './FactionBadge';
import { PortTabs } from './PortTabs';
import { Countdown } from './Countdown';
import { Popup } from './Popup';

describe('ItemCard', () => {
  it('renders name, description and the action slot', () => {
    // String children come from variables: the web lint bans string literals in JSX.
    const actionLabel = 'Sell';
    renderWithProviders(
      <ItemCard
        name="Ore concentrate"
        description="20 units"
        action={<button type="button">{actionLabel}</button>}
      />,
    );
    expect(screen.getByText('Ore concentrate')).toBeInTheDocument();
    expect(screen.getByText('20 units')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sell' })).toBeInTheDocument();
  });
});

describe('RiskBadge', () => {
  it('shows the translated band with its color class', () => {
    renderWithProviders(<RiskBadge band="hi" />);
    const badge = screen.getByText('High risk');
    expect(badge).toHaveClass('risk', 'hi');
    expect(badge).toHaveAttribute('aria-label', 'High risk');
  });
});

describe('FactionBadge', () => {
  it('maps known factions to their color and falls back to independent', () => {
    const { rerender } = renderWithProviders(<FactionBadge factionId="luna" />);
    expect(screen.getByText('Luna Authority')).toHaveClass('fac', 'luna');

    rerender(<FactionBadge factionId="some-corporation" />);
    expect(screen.getByText('Independent')).toHaveClass('fac', 'neutro');
  });
});

describe('PortTabs', () => {
  const tabs = [
    { id: 'market', label: 'Market' },
    { id: 'repair', label: 'Repair', badge: 3 },
  ];

  it('renders tabs with the active one marked and reports clicks', () => {
    const onChange = vi.fn();
    renderWithProviders(<PortTabs tabs={tabs} activeId="market" onChange={onChange} />);

    expect(screen.getByRole('tab', { name: /market/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /repair/i })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /repair/i }));
    expect(onChange).toHaveBeenCalledWith('repair');
  });
});

describe('Countdown', () => {
  it('runs on the server clock: serverTime ahead of the browser shortens the display', () => {
    const now = Date.now();
    renderWithProviders(
      <Countdown
        until={new Date(now + 60_000).toISOString()}
        serverTime={new Date(now + 30_000).toISOString()}
      />,
    );
    // 60s deadline on a clock already 30s ahead → 30s remain.
    expect(screen.getByRole('timer')).toHaveTextContent('00:30');
  });

  it('fires onElapsed exactly once when the deadline passes', () => {
    const onElapsed = vi.fn();
    renderWithProviders(
      <Countdown until={new Date(Date.now() - 1_000).toISOString()} onElapsed={onElapsed} />,
    );
    expect(onElapsed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('timer')).toHaveTextContent('Time is up');
  });
});

describe('Popup', () => {
  const bodyText = 'body';

  it('renders nothing while closed and a titled dialog when open', () => {
    const { rerender } = renderWithProviders(
      <Popup open={false} title="Confirm" onClose={() => {}}>
        {bodyText}
      </Popup>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <Popup open title="Confirm" onClose={() => {}}>
        {bodyText}
      </Popup>,
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Confirm');
    expect(screen.getByText(bodyText)).toBeInTheDocument();
  });

  it('closes through the button, the backdrop and Escape', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <Popup open title="Confirm" onClose={onClose}>
        {bodyText}
      </Popup>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('presentation'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
