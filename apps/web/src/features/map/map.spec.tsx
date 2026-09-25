import { describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByText('You are here')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the side panel on a node click with board link, then closes', async () => {
    const { svg } = await renderMap();

    fireEvent.click(node(svg, 'Porto Ceres — You are here'));
    const dialog = await screen.findByRole('dialog', { name: 'Porto Ceres' });
    expect(withinText(dialog, /Porto Ceres — a node/i)).toBeInTheDocument();
    expect(screen.getByText('Luna Authority')).toBeInTheDocument();
    expect(screen.getByText('Zone 0')).toBeInTheDocument();
    expect(screen.getByText('5 missions on the board')).toBeInTheDocument();

    const boardLink = dialog.querySelector('a[href="/board?location=ceres"]');
    expect(boardLink).not.toBeNull();

    const closeButton = dialog.querySelector('button');
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton as Element);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
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
