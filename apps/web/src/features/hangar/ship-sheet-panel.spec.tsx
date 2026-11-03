import { describe, it, expect, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ShipSheetPanel } from './ship-sheet-panel';
import type { ShipSheet } from '../../api/generated';

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
        shipClass="MULTIROLE"
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
      <ShipSheetPanel
        shipClass="MULTIROLE"
        sheet={sheet}
        problemCount={0}
        installedCatalogs={[]}
      />,
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

  it('shows the warnings as a (!) beside the condition that opens them', () => {
    const onShowWarnings = vi.fn();
    renderWithProviders(
      <ShipSheetPanel
        shipClass="MULTIROLE"
        sheet={sheet}
        problemCount={0}
        warningCount={2}
        onShowWarnings={onShowWarnings}
        installedCatalogs={[]}
      />,
    );
    expect(screen.getByText('Ready to fly')).toBeInTheDocument();
    const button = within(headlineTile('Condition')).getByRole('button', { name: 'Warnings (2)' });
    fireEvent.click(button);
    expect(onShowWarnings).toHaveBeenCalledTimes(1);
  });

  it('has no (!) without warnings, and a gear on the mobility only when tuning is offered', () => {
    const onTuneEngines = vi.fn();
    const { unmount } = renderWithProviders(
      <ShipSheetPanel
        shipClass="MULTIROLE"
        sheet={sheet}
        problemCount={0}
        installedCatalogs={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: /Warnings/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Engine tuning' })).toBeNull();
    unmount();
    renderWithProviders(
      <ShipSheetPanel
        shipClass="MULTIROLE"
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
      <ShipSheetPanel
        shipClass="MULTIROLE"
        sheet={sheet}
        problemCount={0}
        installedCatalogs={[]}
      />,
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
        shipClass="MULTIROLE"
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
        shipClass="MULTIROLE"
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
  it('shows the ship name at the top of the sheet with a Rename button', () => {
    const onRename = vi.fn();
    renderWithProviders(
      <ShipSheetPanel
        shipClass="MULTIROLE"
        shipName="LUN-NOVA"
        onRename={onRename}
        sheet={sheet}
        problemCount={0}
        installedCatalogs={[]}
      />,
    );
    const row = screen.getByTestId('ship-name-row');
    expect(row).toHaveTextContent('LUN-NOVA');
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    expect(onRename).toHaveBeenCalledTimes(1);
  });
});
