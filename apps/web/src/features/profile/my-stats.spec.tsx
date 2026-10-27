import { describe, it, expect, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { MyStats } from './my-stats';
import { myStatsFixture } from './profile-fixtures';
import i18n from '../../i18n';

describe('MyStats', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows net money = earned − spent', async () => {
    renderWithProviders(<MyStats stats={myStatsFixture()} />, { withRouter: false });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Money' }));

    // earned = 1400 + 80 + 24 = 1504; spent = 300 + 36 + 50 + 700 = 1086; net = 418
    expect(screen.getByText('1,504 ¢')).toBeInTheDocument();
    expect(screen.getByText('1,086 ¢')).toBeInTheDocument();
    expect(screen.getByText('418 ¢')).toBeInTheDocument();
  });

  it('switches tabs', async () => {
    renderWithProviders(<MyStats stats={myStatsFixture()} />, { withRouter: false });

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Combat' }));
    expect(screen.getByText('Won')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Records' }));
    expect(screen.getByText('Biggest payout')).toBeInTheDocument();
  });

  it('renders Portuguese labels when the locale is pt-BR', async () => {
    await i18n.changeLanguage('pt-BR');
    renderWithProviders(<MyStats stats={myStatsFixture()} />, { withRouter: false });

    expect(screen.getByText('Voo')).toBeInTheDocument();
    expect(screen.getByText('Dinheiro')).toBeInTheDocument();
    expect(screen.getByText('Recordes')).toBeInTheDocument();
  });
});
