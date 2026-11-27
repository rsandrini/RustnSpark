import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { ship } from '../../test/msw/handlers';
import type { ActiveMission, ShipResponse } from '../../api/generated';
import { HoldTab } from './hold-tab';

const onMissionShip = (): ShipResponse => ({
  ...ship(),
  status: 'ON_MISSION',
  hold: {
    slots: 3,
    parts: 1,
    missionCargo: 0,
    capacity: 40,
    used: 0,
    free: 40,
    partsOver: false,
    cargoOver: false,
    over: false,
  },
});

const flying = (cargo: { mode: 'min' | 'fixed' | 'open'; need: number }): ActiveMission =>
  ({
    id: 'm-1',
    status: 'IN_TRANSIT',
    type: 'DELIVERY',
    brief: { title: { en: 'Ore run', 'pt-BR': 'Corrida de minério' }, description: {} },
    info: { cargo: { ...cargo, unitPay: 2 } },
    legWindows: [],
  }) as unknown as ActiveMission;

function useFlight(mission: ActiveMission): void {
  server.use(
    http.get('/v1/ships', () => HttpResponse.json([onMissionShip()])),
    http.get('/v1/missions/active', () => HttpResponse.json([mission])),
  );
}

describe('HoldTab', () => {
  it('lists the held parts and materials while the ship is on a mission, read-only', async () => {
    useFlight(flying({ mode: 'fixed', need: 12 }));
    renderWithProviders(<HoldTab />);
    expect(await screen.findByTestId('goods-ore')).toHaveTextContent('Iron');
    expect(screen.getByTestId('goods-ore')).toHaveTextContent('6');
    expect(screen.getByTestId('goods-ore').querySelector('.hold-card')).not.toBeNull();
    // the card carries no description: it is in the tooltip
    expect(document.querySelector('.hold-card .goods-row-desc')).toBeNull();
    expect(screen.queryByRole('button', { name: /sell/i })).toBeNull();
    // a part card in the hold carries no action beyond its details button
    const tiles = document.querySelectorAll('.hold-tile');
    expect(tiles.length).toBeGreaterThan(0);
    expect(document.querySelector('.pcard')).toBeNull();
    tiles.forEach((tile) => expect(tile.querySelectorAll('button:not(.info-btn)')).toHaveLength(0));
    expect(screen.getByText('Sell at a port.')).toBeInTheDocument();
  });

  it('shows the spare-part slots, the cargo space and what the mission carries', async () => {
    useFlight(flying({ mode: 'fixed', need: 12 }));
    renderWithProviders(<HoldTab />);
    expect(await screen.findByTestId('hold-usage')).toHaveTextContent('Cargo space 12 of 40');
    expect(screen.getByTestId('hold-usage')).toHaveTextContent('1 of 3');
    expect(screen.getByTestId('hold-carrying')).toHaveTextContent('Carrying 12 units for Ore run');
  });

  it('counts the ore space of a mining run and leaves the sell hint to a ship that is away', async () => {
    server.use(
      http.get('/v1/ships', () => HttpResponse.json([onMissionShip()])),
      http.get('/v1/missions/active', () =>
        HttpResponse.json([
          {
            ...flying({ mode: 'min', need: 1 }),
            type: 'MINING',
            info: { mining: { spaceUnits: 20 } },
          },
        ]),
      ),
    );
    renderWithProviders(<HoldTab />);
    expect(await screen.findByTestId('hold-usage')).toHaveTextContent('Ore space 20');
    expect(screen.getByTestId('hold-usage')).not.toHaveTextContent('Cargo space');
  });

  it('hides the sell hint while docked', async () => {
    server.use(
      http.get('/v1/ships', () => HttpResponse.json([{ ...onMissionShip(), status: 'IN_PORT' }])),
      http.get('/v1/missions/active', () => HttpResponse.json([])),
    );
    renderWithProviders(<HoldTab />);
    await screen.findByTestId('goods-ore');
    expect(screen.queryByText('Sell at a port.')).toBeNull();
  });

  it('says nothing about a load when the mission carries none', async () => {
    useFlight(flying({ mode: 'min', need: 12 }));
    renderWithProviders(<HoldTab />);
    expect(await screen.findByTestId('hold-usage')).toHaveTextContent('Cargo space 0 of 40');
    expect(screen.queryByTestId('hold-carrying')).toBeNull();
  });

  it('opens a material description in a tooltip on tap', async () => {
    useFlight(flying({ mode: 'fixed', need: 12 }));
    renderWithProviders(<HoldTab />);
    const card = (await screen.findByTestId('goods-ore')).querySelector('.hold-card');
    expect(card).not.toBeNull();
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.click(card as Element);
    expect(await screen.findByRole('tooltip')).toBeInTheDocument();
  });

  it('lays the cards in a shrinkable responsive grid', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/ship.css'), 'utf8');
    expect(css).toMatch(/\.hold-grid\s*{[^}]*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.hold-card\s*{[^}]*min-width:\s*0/);
  });
});
