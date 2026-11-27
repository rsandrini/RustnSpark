import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { ship } from '../../test/msw/handlers';
import type { ActiveMission, ShipResponse } from '../../api/generated';
import { HoldPanel } from './hold-panel';

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

describe('HoldPanel', () => {
  it('lists the held parts and materials while the ship is on a mission, read-only', async () => {
    useFlight(flying({ mode: 'fixed', need: 12 }));
    renderWithProviders(<HoldPanel open onToggle={() => undefined} />);
    expect(await screen.findByTestId('goods-ore')).toHaveTextContent('Iron');
    expect(screen.getByTestId('goods-ore')).toHaveTextContent('6');
    expect(screen.queryByRole('button', { name: /sell/i })).toBeNull();
    // a part card in the hold carries no action beyond its details button
    const cards = document.querySelectorAll('.pcard');
    expect(cards.length).toBeGreaterThan(0);
    cards.forEach((card) => expect(card.querySelectorAll('button:not(.info-btn)')).toHaveLength(0));
    expect(screen.getByText('Sell at a port.')).toBeInTheDocument();
  });

  it('shows the spare-part slots, the cargo space and what the mission carries', async () => {
    useFlight(flying({ mode: 'fixed', need: 12 }));
    renderWithProviders(<HoldPanel open onToggle={() => undefined} />);
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
    renderWithProviders(<HoldPanel open onToggle={() => undefined} />);
    expect(await screen.findByTestId('hold-usage')).toHaveTextContent('Ore space 20');
    expect(screen.getByTestId('hold-usage')).not.toHaveTextContent('Cargo space');
  });

  it('hides the sell hint while docked', async () => {
    server.use(
      http.get('/v1/ships', () => HttpResponse.json([{ ...onMissionShip(), status: 'IN_PORT' }])),
      http.get('/v1/missions/active', () => HttpResponse.json([])),
    );
    renderWithProviders(<HoldPanel open onToggle={() => undefined} />);
    await screen.findByTestId('goods-ore');
    expect(screen.queryByText('Sell at a port.')).toBeNull();
  });

  it('says nothing about a load when the mission carries none', async () => {
    useFlight(flying({ mode: 'min', need: 12 }));
    renderWithProviders(<HoldPanel open onToggle={() => undefined} />);
    expect(await screen.findByTestId('hold-usage')).toHaveTextContent('Cargo space 0 of 40');
    expect(screen.queryByTestId('hold-carrying')).toBeNull();
  });

  it('fetches nothing while closed', () => {
    let calls = 0;
    server.use(
      http.get('/v1/materials', () => {
        calls += 1;
        return HttpResponse.json({ materials: [] });
      }),
    );
    renderWithProviders(<HoldPanel open={false} onToggle={() => undefined} />);
    expect(calls).toBe(0);
  });
});
