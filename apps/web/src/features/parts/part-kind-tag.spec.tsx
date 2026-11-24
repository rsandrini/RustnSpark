import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { PartCard } from './part-card';
import { PartDetail, type PartInfoData } from './part-detail';
import { TrayPartRow } from '../hangar/tray-part-row';
import type { InventoryItem } from '../../api/generated';

function make(partType: string, partClass: string): PartInfoData {
  return {
    displayName: { en: 'Thing', 'pt-BR': 'Coisa' },
    description: { en: 'x', 'pt-BR': 'y' },
    rarity: 'COMMON',
    condition: 100,
    connectors: [{ dx: 0, dy: 0, side: 'N', kind: 'central' }],
    catalog: {
      partType,
      partClass,
      w: 1,
      h: 1,
      mass: 1,
      structureCost: 1,
      partHp: 1,
      basePrice: 1,
      pot: 0,
      pdf: 0,
      bli: 0,
      esc: 0,
      sen: 0,
      crg: 0,
      min: 0,
      energyCont: 0,
      energyCombat: 0,
      fuelCap: 0,
      fuelUse: 0,
      batCharge: 0,
      batOutput: 0,
      batInput: 0,
    } as unknown as PartInfoData['catalog'],
  };
}

const CASES: Array<[string, string, string, string]> = [
  ['shield_common', 'DEFENSE', 'Shield', 'Defense'],
  ['passenger_cabin_common', 'CARGO', 'Cabin', 'Cargo'],
  ['mining_rig_common', 'UTILITY', 'Mining', 'Utility'],
];

const surfaces: Array<[string, (p: PartInfoData) => void]> = [
  ['store card', (p) => renderWithProviders(<PartCard part={p} />)],
  [
    'tray row',
    (p) =>
      renderWithProviders(
        <TrayPartRow
          part={{ id: 'p1', broken: false, ...p } as unknown as InventoryItem}
          name="Thing"
          disabled={false}
          selected={false}
          onSelect={() => undefined}
          compare={undefined}
        />,
      ),
  ],
  ['part popup', (p) => renderWithProviders(<PartDetail part={p} />)],
];

describe.each(surfaces)('%s meta line shows the part type', (_name, render) => {
  it.each(CASES)('%s shows %s, not %s', (type, cls, kind, oldWord) => {
    render(make(type, cls));
    expect(screen.getByText(kind)).toBeInTheDocument();
    expect(screen.queryByText(oldWord)).toBeNull();
  });
  it('falls back to the class label for an unknown family', () => {
    render(make('mystery_common', 'UTILITY'));
    expect(screen.getByText('Utility')).toBeInTheDocument();
  });
  it('keeps the icon hidden from assistive tech', () => {
    render(make('shield_common', 'DEFENSE'));
    const label = screen.getByText('Shield');
    expect(label.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
