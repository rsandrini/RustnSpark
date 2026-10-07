import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ShipSheetPanel } from './ship-sheet-panel';
import type { ShipSheet } from '../../api/generated';

const sheet: ShipSheet = {
  pot: 25, pdf: 0, bli: 0, esc: 0, sen: 0, crg: 5, min: 0, hp: 40, mass: 24, energyCont: 0,
  energyCombat: 0, batCharge: 0, batOutput: 0, batInput: 0, fuelCap: 100, fuelUse: 7,
  structureUsed: 10, structureBudget: 40, autonomy: 1428.6, mob: 2, condition: 100,
};

function headlineTile(label: string): HTMLElement {
  return within(screen.getByTestId('sheet-headline'))
    .getByText(label)
    .closest('.sheet-headline-tile') as HTMLElement;
}

describe('ShipSheetPanel range', () => {
  it('shows the range as a plain distance with how many routes it covers', () => {
    renderWithProviders(
      <ShipSheetPanel
        shipClass="MULTIROLE"
        sheet={sheet}
        problemCount={0}
        routeCoverage={{ covered: 14, total: 17 }}
        installedCatalogs={[]}
      />,
    );
    const tile = headlineTile('Range');
    expect(tile).toHaveTextContent('1,428.6');
    expect(tile).toHaveTextContent('covers 14 of 17 routes');
    expect(tile).not.toHaveTextContent('%');
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
    const tile = headlineTile('Range');
    expect(tile).toHaveTextContent('unlimited');
    expect(tile).not.toHaveTextContent('routes');
  });
});
