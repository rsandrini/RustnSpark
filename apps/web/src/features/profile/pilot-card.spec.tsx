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

    const stat = (label: string) =>
      within(screen.getByText(label).closest('div')!);

    expect(stat('Missions').getByText('5')).toBeInTheDocument();
    expect(stat('Success rate').getByText('75%')).toBeInTheDocument();
    expect(stat('Distance').getByText('2,400')).toBeInTheDocument();
    expect(stat('Fights won').getByText('2')).toBeInTheDocument();
    expect(
      stat('Races').getByText('4 entered · 1 won · 2 podiums'),
    ).toBeInTheDocument();
    expect(stat('Best place').getByText('2')).toBeInTheDocument();
    expect(stat('Fastest race').getByText('3:05')).toBeInTheDocument();
    expect(
      stat('Scavenging').getByText('6 ship · 2 on foot'),
    ).toBeInTheDocument();
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
  });

  it('never shows money, damage or part text from private totals', () => {
    renderWithProviders(<PilotCard profile={publicProfileFixture()} />, { withRouter: false });

    // The fixture carries private keys; the card must not render them.
    expect(screen.queryByText('1,400')).not.toBeInTheDocument();
    expect(screen.queryByText('42')).not.toBeInTheDocument();
    expect(screen.queryByText(/Bridge/)).not.toBeInTheDocument();
  });
});
