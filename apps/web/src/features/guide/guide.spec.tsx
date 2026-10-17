import { beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../test/utils';
import { server } from '../../test/msw/server';
import { resetEconomyState } from '../../test/msw/handlers';
import { routes } from '../../app/router';
import { buildIndex, normalize, searchParts, searchTopics } from './guide-search';

const pilot = () =>
  http.get('/v1/players/me', () =>
    HttpResponse.json({
      id: 'player-1',
      name: 'Test Pilot',
      credits: 100,
      role: 'PLAYER',
      locale: 'en',
      factionId: 'luna',
      tutorialDone: true,
    }),
  );

describe('guide', () => {
  beforeEach(() => {
    resetEconomyState();
    server.use(pilot());
  });

  it('is reached from the account menu and lists every topic', async () => {
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    fireEvent.click(await screen.findByRole('link', { name: 'Guide' }));
    const nav = await screen.findByRole('navigation', { name: 'Topics' });
    expect(within(nav).getAllByRole('link')).toHaveLength(9);
    expect(within(nav).getByText('How a run goes')).toBeInTheDocument();
  });

  it('a topic shows its sections and the live numbers from the rules', async () => {
    renderWithRouter(routes, { initialEntries: ['/guide/fuel'] });
    const topic = await screen.findByTestId('guide-topic');
    expect(
      within(topic).getByRole('heading', { name: 'Fuel, repair and wear' }),
    ).toBeInTheDocument();
    // the text quotes the live figure, not a typed-in one
    expect(await within(topic).findByText(/Fuel costs 0\.45 ¢ per unit/)).toBeInTheDocument();
    const live = await screen.findByTestId('guide-live');
    expect(within(live).getByText('Fuel price per unit')).toBeInTheDocument();
    expect(within(live).getByText('800 ¢')).toBeInTheDocument();
  });

  it('search finds a mechanic by its name or a word in its text', async () => {
    renderWithRouter(routes, { initialEntries: ['/guide'] });
    const box = await screen.findByRole('searchbox', { name: 'Search the guide' });
    fireEvent.change(box, { target: { value: 'shield' } });
    const results = await screen.findByTestId('guide-results');
    expect(within(results).getByRole('link', { name: /Shield and armor/ })).toHaveAttribute(
      'href',
      '/guide/parts#defense',
    );
  });

  it('search finds a part by its name and points at the section that explains its class', async () => {
    renderWithRouter(routes, { initialEntries: ['/guide'] });
    const box = await screen.findByRole('searchbox', { name: 'Search the guide' });
    fireEvent.change(box, { target: { value: 'fuel tank' } });
    const link = await screen.findByRole('link', { name: /Small Fuel Tank/ });
    expect(link).toHaveAttribute('href', '/guide/parts#tanks');
  });

  it('says so when nothing matches, and Enter opens the first result', async () => {
    renderWithRouter(routes, { initialEntries: ['/guide'] });
    const box = await screen.findByRole('searchbox', { name: 'Search the guide' });
    fireEvent.change(box, { target: { value: 'qqqqzzzz' } });
    expect(await screen.findByText(/Nothing found for "qqqqzzzz"/)).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'rarity' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByTestId('guide-topic')).toBeInTheDocument();
  });
});

describe('guide search helpers', () => {
  it('ignores case and accents', () => {
    expect(normalize('Mineração')).toBe('mineracao');
  });

  it('needs every word, ranks title hits first and searches part names', () => {
    const t = (key: string) => key;
    const index = buildIndex(t, {});
    expect(searchTopics(index, 'zzzz')).toEqual([]);
    expect(searchTopics(index, '   ')).toEqual([]);
    const parts = [
      { partType: 'a', displayName: 'Small Fuel Tank', partClass: 'TANK' },
      { partType: 'b', displayName: 'Large Fuel Tank', partClass: 'TANK' },
    ];
    expect(searchParts(parts, 'large tank')).toHaveLength(1);
    expect(searchParts(parts, 'fuel')).toHaveLength(2);
    const dupes = [...parts, { partType: 'c', displayName: 'Small Fuel Tank', partClass: 'TANK' }];
    expect(searchParts(dupes, 'small')).toHaveLength(1); // one entry per name
  });
});
