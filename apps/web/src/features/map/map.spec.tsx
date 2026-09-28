import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { routes } from '../../app/router';

const onboarded = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 0,
        role: 'PLAYER',
        locale: 'en',
        factionId: 'luna',
      },
      { status: 200 },
    ),
  );

function node(svg: SVGSVGElement, name: string): SVGGElement {
  const match = svg.querySelector<SVGGElement>(`[aria-label="${name}"]`);
  if (match === null) throw new Error(`node ${name} not found`);
  return match;
}

async function renderMap() {
  server.use(onboarded());
  const view = renderWithRouter(routes, { initialEntries: ['/map'] });
  const heading = await screen.findByRole('heading', { name: 'Sector map' });
  const svg = heading.closest('main')?.querySelector('svg');
  if (svg === null || svg === undefined) throw new Error('map svg not found');
  return { ...view, svg };
}

describe('map (S10.5)', () => {
  it('renders all 12 nodes, routes and the risk legend', async () => {
    const { svg } = await renderMap();

    expect(svg.querySelectorAll('g[role="button"]')).toHaveLength(12);
    expect(svg.querySelectorAll('line.edge')).toHaveLength(17);
    expect(svg.querySelectorAll('text.nlabel')).toHaveLength(12);
    const labels = Array.from(svg.querySelectorAll('text.nlabel')).map((text) => text.textContent);
    expect(labels).toContain('Porto Ceres');
    expect(screen.getByText('Low risk')).toBeInTheDocument();
    expect(screen.getByText('Medium risk')).toBeInTheDocument();
    expect(screen.getByText('High risk')).toBeInTheDocument();
    expect(screen.getAllByText('You are here').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the side panel on a node click with board link, then closes', async () => {
    const { svg } = await renderMap();

    fireEvent.click(node(svg, 'Porto Ceres — You are here'));
    const dialog = await screen.findByRole('dialog', { name: 'Porto Ceres' });
    expect(withinText(dialog, /Porto Ceres — a node/i)).toBeInTheDocument();
    expect(screen.getByText('Luna Authority')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Zone 0');
    expect(await within(dialog).findByText('Missions here')).toBeInTheDocument();

    const boardLink = dialog.querySelector('a[href="/board?location=ceres"]');
    expect(boardLink).not.toBeNull();

    const closeButton = dialog.querySelector('button');
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton as Element);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says why a blocked mission is blocked, same as the Board (owner: "I cannot see why")', async () => {
    const { svg } = await renderMap();

    fireEvent.click(node(svg, 'Porto Ceres — You are here'));
    const dialog = await screen.findByRole('dialog', { name: 'Porto Ceres' });
    expect(await within(dialog).findByText('Needs a mining system')).toBeInTheDocument();
    expect(within(dialog).getByText('Mobility too low')).toBeInTheDocument();
  });

  it('offers a trip to another place: route, time, fuel, and a button that starts it', async () => {
    const { svg } = await renderMap();
    fireEvent.keyDown(node(svg, 'Estaleiro Tycho'), { key: 'Enter' });
    const box = await screen.findByTestId('travel');
    expect(within(box).getByText('Fly there without a mission')).toBeInTheDocument();
    expect(await within(box).findByText('2m 30s')).toBeInTheDocument();
    expect(within(box).getByText(/Fuel 12 of 25 on board/)).toBeInTheDocument();
    expect(within(box).getByText(/pays nothing/)).toBeInTheDocument();
    expect(within(box).getByRole('button', { name: /Fly to Estaleiro Tycho/ })).toBeEnabled();
  });

  it('does not offer a trip to the place you are already at', async () => {
    const { svg } = await renderMap();
    fireEvent.click(node(svg, 'Porto Ceres — You are here'));
    await screen.findByRole('dialog', { name: 'Porto Ceres' });
    expect(screen.queryByTestId('travel')).toBeNull();
  });

  it('selects a node with the keyboard', async () => {
    const { svg } = await renderMap();

    fireEvent.keyDown(node(svg, 'Estaleiro Tycho'), { key: 'Enter' });

    expect(await screen.findByRole('dialog', { name: 'Estaleiro Tycho' })).toBeInTheDocument();
  });

  it('marks the ship location as you-are-here', async () => {
    const { svg } = await renderMap();

    expect(svg.querySelector('[aria-label="Porto Ceres — You are here"]')).not.toBeNull();

    fireEvent.click(node(svg, 'Porto Ceres — You are here'));
    const dialog = await screen.findByRole('dialog', { name: 'Porto Ceres' });
    expect(dialog.textContent).toContain('You are here');
  });

  it('shows the ship on its route while a mission is in flight', async () => {
    const now = Date.now();
    server.use(
      http.get('/v1/missions/active', () =>
        HttpResponse.json([
          {
            id: 'm1',
            templateId: 'delivery_luna',
            type: 'DELIVERY',
            factionId: 'luna',
            originId: 'ceres',
            destinationId: 'gate',
            legs: [],
            cargo: {},
            reward: 100,
            expiresAt: new Date(now + 3_600_000).toISOString(),
            status: 'IN_TRANSIT',
            playerId: 'player-1',
            privatePlayerId: null,
            shipId: 'ship-1',
            acceptedAt: new Date(now - 60_000).toISOString(),
            arrivalAt: new Date(now + 600_000).toISOString(),
            deadlineAt: null,
            seed: 's',
            version: 1,
            legWindows: [
              {
                legIndex: 0,
                routeId: 'ceres-gate',
                from: new Date(now - 300_000).toISOString(),
                to: new Date(now + 300_000).toISOString(),
              },
            ],
          },
        ]),
      ),
    );
    const { svg } = await renderMap();
    await waitFor(() => expect(svg.querySelector('.ship-marker')).not.toBeNull());
    expect(svg.querySelector('polyline.flight-path')).not.toBeNull();
    expect(screen.getByTestId('map-status')).toHaveTextContent(/In flight/);
    expect(svg.querySelector('.you-tag')).toBeNull();
  });

  it('highlights corridors from the server hot flag, with no threshold of its own', async () => {
    const { svg } = await renderMap();
    const hot = svg.querySelectorAll('line.edge.hot').length;
    expect(hot).toBeGreaterThan(0);
    expect(hot).toBeLessThan(17);
  });
});

function withinText(container: HTMLElement, pattern: RegExp): Element {
  const match = Array.from(container.querySelectorAll('*')).find(
    (element) => element.children.length === 0 && pattern.test(element.textContent ?? ''),
  );
  if (match === undefined) throw new Error(`text ${pattern.source} not found`);
  return match;
}
