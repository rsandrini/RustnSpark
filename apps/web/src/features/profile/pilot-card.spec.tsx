import { describe, it, expect, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { PilotCard } from './pilot-card';
import { emptyPublicProfileFixture, publicProfileFixture } from './profile-fixtures';
import i18n from '../../i18n';

describe('PilotCard', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders each public number from a fixture', () => {
    renderWithProviders(<PilotCard profile={publicProfileFixture()} />, { withRouter: false });

    expect(screen.getByText('Test Pilot')).toBeInTheDocument();
    expect(screen.getByText('LUN-TestPilot-Wren')).toBeInTheDocument();

    const stat = (label: string) => within(screen.getByText(label).closest('div')!);

    expect(stat('Missions').getByText('5')).toBeInTheDocument();
    expect(stat('Success rate').getByText('75%')).toBeInTheDocument();
    expect(stat('Distance').getByText('2,400')).toBeInTheDocument();
    expect(stat('Race wins').getByText('1')).toBeInTheDocument();
    expect(stat('Fights won').getByText('2')).toBeInTheDocument();
    expect(stat('Races').getByText('4 entered · 1 won · 2 podiums')).toBeInTheDocument();
    expect(stat('Best place').getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('pilot-avatar')).toHaveTextContent('T');
    expect(screen.getByRole('img', { name: 'Ship profile' })).toBeInTheDocument();
    // no scavenging, fastest-race or joined-date lines on the card
    expect(screen.queryByText('Fastest race')).toBeNull();
    expect(screen.queryByText('Scavenging')).toBeNull();
    expect(screen.queryByText(/Joined/)).toBeNull();
  });

  it('shows "No flights yet" for a pilot with zero missions and no NaN', () => {
    renderWithProviders(<PilotCard profile={emptyPublicProfileFixture()} />, { withRouter: false });

    expect(screen.getByText('No flights yet')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('renders Portuguese labels when the locale is pt-BR', async () => {
    await i18n.changeLanguage('pt-BR');
    renderWithProviders(<PilotCard profile={publicProfileFixture()} />, { withRouter: false });

    expect(screen.getByText('Missões')).toBeInTheDocument();
    expect(screen.getByText('Taxa de sucesso')).toBeInTheDocument();
    expect(screen.getByText('Distância')).toBeInTheDocument();
    expect(screen.getByText('Combates vencidos')).toBeInTheDocument();
    expect(screen.getByText('Corridas')).toBeInTheDocument();
    expect(screen.getByText('Vitórias em corrida')).toBeInTheDocument();
  });

  it('never shows money, damage or part text from private totals', () => {
    renderWithProviders(<PilotCard profile={publicProfileFixture()} />, { withRouter: false });

    // The fixture carries private keys; the card must not render them.
    expect(screen.queryByText('1,400')).not.toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
    expect(screen.queryByText(/Bridge/)).not.toBeInTheDocument();
  });

  it('shows a small radar and the type with its modifier', () => {
    const profile = publicProfileFixture();
    profile.ship = { ...profile.ship!, shipClass: 'RACER', profileModifier: 'range' };
    renderWithProviders(<PilotCard profile={profile} />, { withRouter: false });
    expect(screen.getByRole('img', { name: 'Ship profile' })).toBeInTheDocument();
    expect(screen.getByText(/Racer, long-range/)).toBeInTheDocument();
  });

  it('has four big tiles and the details on a second line', () => {
    const { container } = renderWithProviders(<PilotCard profile={publicProfileFixture()} />, {
      withRouter: false,
    });
    expect(container.querySelectorAll('.pilot-stats .pilot-stat')).toHaveLength(4);
    expect(container.querySelector('.pilot-details')).toHaveTextContent('Fights won');
  });

  it('shows no ship panel and no radar without a ship', () => {
    const profile = publicProfileFixture();
    profile.ship = null;
    const { container } = renderWithProviders(<PilotCard profile={profile} />, {
      withRouter: false,
    });
    expect(container.querySelector('.pilot-ship')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Ship profile' })).toBeNull();
  });

  it('a never-flown pilot shows the empty state and no tiles', () => {
    const { container } = renderWithProviders(<PilotCard profile={emptyPublicProfileFixture()} />, {
      withRouter: false,
    });
    expect(screen.getByText('No flights yet')).toBeInTheDocument();
    expect(container.querySelector('.pilot-stat')).toBeNull();
    expect(container.querySelector('.pilot-details')).toBeNull();
  });

  it('a very long name keeps the truncating name class', () => {
    const profile = publicProfileFixture();
    profile.name = 'W'.repeat(120);
    renderWithProviders(<PilotCard profile={profile} />, { withRouter: false });
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('pilot-name');
  });
});
