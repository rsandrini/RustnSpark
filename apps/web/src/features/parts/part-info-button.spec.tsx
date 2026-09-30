import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { PartInfoButton } from './part-info-button';
import type { PartInfoData } from './part-detail';
import type { ShipSheet } from '../../api/generated';

// A full sheet (every ShipSheetSchema field required — a bare partial would leave every
// row but the one under test reading NaN), same fixture shape as hangar.spec.tsx's testSheet.
const baseSheet: ShipSheet = {
  pot: 25,
  pdf: 0,
  bli: 12,
  esc: 0,
  sen: 2,
  crg: 5,
  min: 0,
  hp: 40,
  mass: 24,
  energyCont: 8,
  energyCombat: 0,
  batCharge: 4,
  batOutput: 10,
  batInput: 8,
  fuelCap: 40,
  fuelUse: 1,
  structureUsed: 18,
  structureBudget: 40,
  autonomy: 40,
  mob: 2,
  condition: 100,
};

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
};

// A market listing: no owned instance id, matching the real shape (MarketListing has none).
const listingPart: PartInfoData = {
  displayName: { en: 'Reinforced Cargo Rack', 'pt-BR': 'Suporte de Carga Reforçado' },
  description: { en: 'A bigger cargo rack.', 'pt-BR': 'Um suporte de carga maior.' },
  rarity: 'UNCOMMON',
  catalog,
  condition: 100,
};

describe('PartInfoButton: market (not-owned-yet) comparison', () => {
  it('asks for a virtual-part swap preview and shows it under a "swap" title', async () => {
    server.use(
      http.post('/v1/ships/:id/preview', async ({ request }) => {
        const body = (await request.json()) as {
          virtualPart?: { partType: string; condition: number };
          replacePartInstanceId?: string;
        };
        expect(body.virtualPart).toEqual({ partType: 'cargo_uncommon', condition: 100 });
        expect(body.replacePartInstanceId).toBe('part-cargo-a');
        return HttpResponse.json({
          sheet: { ...baseSheet, crg: baseSheet.crg + 8 },
          shipClass: 'MULTIROLE',
          viability: { viable: true, problems: [] },
          layout: [],
          omittedPartInstanceIds: [],
        });
      }),
    );

    renderWithProviders(
      <PartInfoButton
        part={listingPart}
        compare={{
          shipId: 'ship-1',
          installedPartIds: ['part-cargo-a'],
          currentSheet: baseSheet,
          replace: {
            partInstanceId: 'part-cargo-a',
            displayName: { en: 'Cargo Rack', 'pt-BR': 'Suporte de Carga' },
          },
        }}
      />,
      { withRouter: false },
    );

    fireEvent.click(screen.getByRole('button', { name: /Details/i }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByText(/swap this in for Cargo Rack/i)).toBeInTheDocument(),
    );

    const cargoRow = within(dialog).getByRole('row', { name: /^Cargo/ });
    await waitFor(() => expect(within(cargoRow).getByText('+8')).toBeInTheDocument());
    expect(within(cargoRow).getByText('+8')).toHaveClass('delta-good');
  });
});
