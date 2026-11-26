import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ShipSheetPanel } from './ship-sheet-panel';
import type { ShipProfile, ShipSheet } from '../../api/generated';

const sheet: ShipSheet = {
  pot: 25,
  pdf: 0,
  bli: 0,
  esc: 0,
  sen: 0,
  crg: 5,
  min: 0,
  hp: 40,
  mass: 24,
  energyCont: 0,
  energyCombat: 0,
  batCharge: 0,
  batOutput: 0,
  batInput: 0,
  fuelCap: 100,
  fuelUse: 7,
  pax: 0,
  lifeCap: 0,
  structureUsed: 10,
  structureBudget: 40,
  autonomy: 1428.6,
  mob: 2,
  condition: 100,
};

function headlineTile(label: string): HTMLElement {
  return within(screen.getByTestId('sheet-headline'))
    .getByText(label)
    .closest('.sheet-headline-tile') as HTMLElement;
}

function rangeRow(): HTMLElement {
  fireEvent.click(screen.getByText('Show all stats'));
  return screen
    .getByText('Range', { selector: '.statrow span' })
    .closest('.statrow') as HTMLElement;
}

describe('ShipSheetPanel defense', () => {
  it('shows the shield and the armor as their own tiles, as a fight would start (worn or unconnected parts give less)', () => {
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={{ ...sheet, bli: 10, esc: 20 }}
        problemCount={0}
        layers={{ shield: 7, armor: 23, hull: 100, shieldRegen: 1 }}
        installedCatalogs={[]}
      />,
    );
    const shield = headlineTile('Shield');
    expect(shield).toHaveTextContent('7');
    expect(shield).not.toHaveTextContent('20');
    const armor = headlineTile('Armor');
    expect(armor).toHaveTextContent('23');
    expect(armor).not.toHaveTextContent('50');
  });
});

describe('ShipSheetPanel headline', () => {
  it('puts the structure first and keeps the range out of the headline', () => {
    renderWithProviders(
      <ShipSheetPanel shipClass="BALANCED" sheet={sheet} problemCount={0} installedCatalogs={[]} />,
    );
    const tiles = within(screen.getByTestId('sheet-headline')).getAllByText(
      /^(Structure|Firepower|Shield|Armor|Cargo|Mobility|Condition|Energy|Range)$/,
    );
    expect(tiles.map((tile) => tile.textContent)).toEqual([
      'Structure',
      'Firepower',
      'Shield',
      'Armor',
      'Cargo',
      'Mobility',
      'Condition',
      'Energy',
    ]);
  });

  const pushed = { chem: 1.45, ion: 1 };

  it('has no warning mark on the Condition tile', () => {
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        warningCount={2}
        onShowWarnings={vi.fn()}
        installedCatalogs={[]}
      />,
    );
    expect(screen.getByText('Ready to fly')).toBeInTheDocument();
    const tile = headlineTile('Condition');
    expect(within(tile).queryByRole('button')).toBeNull();
    expect(tile.textContent).not.toContain('\u26A0');
  });

  it('the overdrive badge opens the warnings when there are any', () => {
    const onShowWarnings = vi.fn();
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        warningCount={2}
        engineLevels={pushed}
        onShowWarnings={onShowWarnings}
        onTuneEngines={vi.fn()}
        installedCatalogs={[]}
      />,
    );
    const badge = screen.getByTestId('engines-pushed');
    expect(badge.tagName).toBe('BUTTON');
    expect(badge).toHaveAccessibleName('Warnings (2)');
    expect(badge).toHaveTextContent('▲ 145%');
    fireEvent.click(badge);
    expect(onShowWarnings).toHaveBeenCalledTimes(1);
  });

  it('the overdrive badge opens the engine tuning when there are no warnings', () => {
    const onTuneEngines = vi.fn();
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        warningCount={0}
        engineLevels={pushed}
        onShowWarnings={vi.fn()}
        onTuneEngines={onTuneEngines}
        installedCatalogs={[]}
      />,
    );
    fireEvent.click(screen.getByTestId('engines-pushed'));
    expect(onTuneEngines).toHaveBeenCalledTimes(1);
  });

  it('warnings with engines not pushed are on the status line', () => {
    const onShowWarnings = vi.fn();
    const { container } = renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        warningCount={2}
        engineLevels={{ chem: 1, ion: 1 }}
        onShowWarnings={onShowWarnings}
        installedCatalogs={[]}
      />,
    );
    expect(screen.queryByTestId('engines-pushed')).toBeNull();
    fireEvent.click(
      within(container.querySelector('.sheet-status') as HTMLElement).getByRole('button', {
        name: 'Warnings (2)',
      }),
    );
    expect(onShowWarnings).toHaveBeenCalledTimes(1);
  });

  it('with the headline hidden by "Show all stats", the status line carries the warnings', () => {
    const onShowWarnings = vi.fn();
    const { container } = renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        warningCount={2}
        engineLevels={pushed}
        onShowWarnings={onShowWarnings}
        installedCatalogs={[]}
      />,
    );
    fireEvent.click(screen.getByText('Show all stats'));
    expect(screen.queryByTestId('engines-pushed')).toBeNull();
    fireEvent.click(
      within(container.querySelector('.sheet-status') as HTMLElement).getByRole('button', {
        name: 'Warnings (2)',
      }),
    );
    expect(onShowWarnings).toHaveBeenCalledTimes(1);
  });

  it('a pushed badge with no callbacks stays a span', () => {
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        engineLevels={pushed}
        installedCatalogs={[]}
      />,
    );
    expect(screen.getByTestId('engines-pushed').tagName).toBe('SPAN');
  });

  it('warnings without onShowWarnings show no warnings button anywhere', () => {
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        warningCount={2}
        engineLevels={pushed}
        installedCatalogs={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: /Warnings/ })).toBeNull();
  });

  it('has no (!) without warnings, and a gear on the mobility only when tuning is offered', () => {
    const onTuneEngines = vi.fn();
    const { unmount } = renderWithProviders(
      <ShipSheetPanel shipClass="BALANCED" sheet={sheet} problemCount={0} installedCatalogs={[]} />,
    );
    expect(screen.queryByRole('button', { name: /Warnings/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Engine tuning' })).toBeNull();
    unmount();
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        onTuneEngines={onTuneEngines}
        installedCatalogs={[]}
      />,
    );
    fireEvent.click(
      within(headlineTile('Mobility')).getByRole('button', { name: 'Engine tuning' }),
    );
    expect(onTuneEngines).toHaveBeenCalledTimes(1);
  });

  it('shows only the full list while "Show all stats" is open', () => {
    renderWithProviders(
      <ShipSheetPanel shipClass="BALANCED" sheet={sheet} problemCount={0} installedCatalogs={[]} />,
    );
    expect(screen.getByTestId('sheet-headline')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show all stats'));
    expect(screen.queryByTestId('sheet-headline')).toBeNull();
    fireEvent.click(screen.getByText('Show all stats'));
    expect(screen.getByTestId('sheet-headline')).toBeInTheDocument();
  });
});

describe('ShipSheetPanel range', () => {
  it('shows the range in the full list as a plain distance with how many routes it covers', () => {
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={sheet}
        problemCount={0}
        routeCoverage={{ covered: 14, total: 17 }}
        installedCatalogs={[]}
      />,
    );
    const row = rangeRow();
    expect(row).toHaveTextContent('1,428.6');
    expect(row).toHaveTextContent('covers 14 of 17 routes');
    expect(row).not.toHaveTextContent('%');
  });

  it('says unlimited for a ship that burns no fuel, with no route count', () => {
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        sheet={{ ...sheet, fuelUse: 0, fuelCap: 0, autonomy: 0 }}
        problemCount={0}
        routeCoverage={null}
        installedCatalogs={[]}
      />,
    );
    const row = rangeRow();
    expect(row).toHaveTextContent('unlimited');
    expect(row).not.toHaveTextContent('routes');
  });
});

describe('ShipSheetPanel name', () => {
  it('shows the ship name at the top of the sheet and clicking the name renames the ship', () => {
    const onRename = vi.fn();
    renderWithProviders(
      <ShipSheetPanel
        shipClass="BALANCED"
        shipName="LUN-NOVA"
        onRename={onRename}
        sheet={sheet}
        problemCount={0}
        installedCatalogs={[]}
      />,
    );
    const row = screen.getByTestId('ship-name-row');
    expect(row).toHaveTextContent('LUN-NOVA');
    fireEvent.click(within(row).getByRole('button', { name: /Rename the ship/ }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});

describe('ShipSheetPanel ship identity', () => {
  const profile: ShipProfile = {
    cargo: 0.8,
    passengers: 0,
    firepower: 0.5,
    defense: 0.1,
    mobility: 0.1,
    range: 0.1,
    mining: 0,
  };
  const base = { shipClass: 'HAULER', sheet, problemCount: 0, installedCatalogs: [] };

  const showProfile = () => fireEvent.click(screen.getByRole('button', { name: 'Profile' }));

  it('shows the type with its modifier; the Stats view has no radar', () => {
    renderWithProviders(<ShipSheetPanel {...base} profile={profile} profileModifier="firepower" />);
    expect(screen.getByText('Hauler, armed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stats' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('img', { name: 'Ship profile' })).toBeNull();
    expect(screen.queryByTestId('profile-breakdown')).toBeNull();
    expect(screen.getByTestId('sheet-headline')).toBeInTheDocument();
  });

  it('the Profile view shows the radar and the breakdown, and the choice is remembered', () => {
    window.localStorage.clear();
    const first = renderWithProviders(
      <ShipSheetPanel {...base} profile={profile} profileModifier="firepower" />,
    );
    showProfile();
    expect(screen.getByRole('button', { name: 'Profile' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: 'Ship profile' })).toBeInTheDocument();
    expect(screen.getByTestId('profile-breakdown')).toBeInTheDocument();
    expect(first.container.querySelector('.kit-radar-ghost')).toBeNull();
    first.unmount();
    renderWithProviders(<ShipSheetPanel {...base} profile={profile} />);
    expect(screen.getByTestId('profile-breakdown')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stats' }));
    expect(screen.getByTestId('sheet-headline')).toBeInTheDocument();
    window.localStorage.clear();
  });

  it('keeps warnings, engine tuning and structure reachable in the Profile view', () => {
    window.localStorage.setItem('hangar.sheetView', 'profile');
    const onShowWarnings = vi.fn();
    const onTuneEngines = vi.fn();
    renderWithProviders(
      <ShipSheetPanel
        {...base}
        profile={profile}
        warningCount={2}
        onShowWarnings={onShowWarnings}
        onTuneEngines={onTuneEngines}
      />,
    );
    expect(screen.getByTestId('profile-breakdown')).toBeInTheDocument();
    expect(headlineTile('Structure')).toHaveTextContent('10 / 40');
    const status = document.querySelector('.sheet-status') as HTMLElement;
    fireEvent.click(within(status).getByRole('button', { name: /warning/i }));
    expect(onShowWarnings).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /engine/i }));
    expect(onTuneEngines).toHaveBeenCalled();
    window.localStorage.clear();
  });

  it('badges the Profile segment only while a differing preview exists, in either view', () => {
    window.localStorage.clear();
    const badge = () => screen.queryByRole('img', { name: 'Preview changes the profile' });
    const a = renderWithProviders(<ShipSheetPanel {...base} profile={profile} />);
    expect(badge()).toBeNull();
    a.unmount();
    const b = renderWithProviders(
      <ShipSheetPanel {...base} profile={profile} ghostProfile={{ ...profile }} />,
    );
    expect(badge()).toBeNull();
    b.unmount();
    renderWithProviders(
      <ShipSheetPanel {...base} profile={profile} ghostProfile={{ ...profile, cargo: 0.3 }} />,
    );
    expect(badge()).not.toBeNull();
  });

  it('shows the bare type without a modifier', () => {
    renderWithProviders(<ShipSheetPanel {...base} profile={profile} profileModifier={null} />);
    expect(screen.getByText('Hauler')).toBeInTheDocument();
  });

  it('draws the preview profile as the ghost only when it differs', () => {
    window.localStorage.setItem('hangar.sheetView', 'profile');
    const first = renderWithProviders(
      <ShipSheetPanel {...base} profile={profile} ghostProfile={{ ...profile, cargo: 0.3 }} />,
    );
    expect(first.container.querySelector('.kit-radar-ghost')).not.toBeNull();
    first.unmount();
    const second = renderWithProviders(
      <ShipSheetPanel {...base} profile={profile} ghostProfile={{ ...profile }} />,
    );
    expect(second.container.querySelector('.kit-radar-ghost')).toBeNull();
    window.localStorage.clear();
  });

  it('renders no radar and does not crash without a profile', () => {
    renderWithProviders(<ShipSheetPanel {...base} />);
    expect(screen.queryByRole('img', { name: 'Ship profile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull();
    expect(screen.getByText('Hauler')).toBeInTheDocument();
  });

  it('hides the radar in the opening (compact sheet)', () => {
    window.localStorage.setItem('hangar.sheetView', 'profile');
    renderWithProviders(<ShipSheetPanel {...base} compact profile={profile} />);
    expect(screen.queryByRole('img', { name: 'Ship profile' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull();
    expect(screen.getByTestId('sheet-headline')).toBeInTheDocument();
    window.localStorage.clear();
  });
});
