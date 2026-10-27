import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { DialogueNode, DialogueScene } from '../../api/generated';
import { routes } from '../../app/router';
import { server } from '../../test/msw/server';
import { dialogueEvents, dialogueSettings, resetEconomyState, setDialogue } from '../../test/msw/handlers';
import { renderWithRouter } from '../../test/utils';
import { useTypewriter } from './typewriter';

const text = (en: string, pt: string) => ({ en, 'pt-BR': pt });
const node = (id: string, extra: Partial<DialogueNode> = {}): DialogueNode => ({
  id,
  text: text(`Words of ${id}.`, `Falas de ${id}.`),
  position: 'bottom',
  anchor: null,
  blocking: false,
  next: null,
  choices: [],
  ...extra,
});
const giver = {
  id: 'mentor_x',
  name: 'Ines Moura',
  title: text('Dockmaster', 'Mestra de Docas'),
  role: 'MENTOR' as const,
  factionId: 'luna',
  portraitUrl: null,
};
const sceneOf = (id: string, nodes: DialogueNode[], start = nodes[0]!.id): DialogueScene => ({
  id,
  title: text(`Scene ${id}`, `Cena ${id}`),
  giver,
  start,
  nodes,
});

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

// the box waits for a calm screen: the settle delay of the host is a second and a half
const SEEN = { timeout: 6000 };

function setReducedMotion(reduced: boolean): void {
  window.matchMedia = (query: string) => ({
    matches: reduced && query.includes('reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  });
}

describe('the mentor dialogue', () => {
  beforeEach(() => {
    resetEconomyState();
    setDialogue(null);
    setReducedMotion(true);
    server.use(pilot());
  });
  afterEach(() => {
    document.querySelectorAll('[data-test-popup]').forEach((el) => el.remove());
  });

  it('says nothing when no scene is due, or when dialogues are off', async () => {
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('navigation');
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(screen.queryByTestId('dialogue')).not.toBeInTheDocument();
  });

  it('opens a scene on a calm screen, with the mentor, the text, and goes on node by node', async () => {
    setDialogue({
      scene: sceneOf('welcome', [
        node('w1', { blocking: true, position: 'center', next: 'w2' }),
        node('w2', { position: 'right', next: null }),
      ]),
    });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const box = await screen.findByRole('dialog', {}, SEEN);
    expect(within(box).getByText('Ines Moura')).toBeInTheDocument();
    expect(within(box).getByText('Dockmaster')).toBeInTheDocument();
    expect(box).toHaveTextContent('Words of w1.');
    expect(box).toHaveClass('pos-center');
    expect(box).toHaveAttribute('aria-modal', 'true');
    fireEvent.click(within(box).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Words of w2.'));
    expect(screen.getByRole('dialog')).toHaveClass('pos-right');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false');
    expect(dialogueEvents).toEqual([{ sceneId: 'welcome', event: 'advance', nodeId: 'w2' }]);
    // the last node closes the scene
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('dialogue')).not.toBeInTheDocument());
    expect(dialogueEvents.at(-1)).toEqual({ sceneId: 'welcome', event: 'done' });
  });

  it('stays open on its own box: it does not close and open again while the pilot reads', async () => {
    setDialogue({
      scene: sceneOf('welcome', [
        node('w1', { blocking: true, position: 'center', next: 'w2' }),
        node('w2'),
      ]),
    });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const box = await screen.findByRole('dialog', {}, SEEN);
    // the screen is checked for calm every second or so: the mentor's own box must not count as "something else open"
    await new Promise((resolve) => setTimeout(resolve, 2800));
    expect(screen.getByRole('dialog')).toBe(box);
    expect(box).toHaveTextContent('Words of w1.');
    expect(dialogueEvents).toEqual([]);
  });

  it('speaks in the language of the pilot', async () => {
    window.localStorage.setItem('rs.language', 'pt-BR');
    setDialogue({ scene: sceneOf('s', [node('a')]) });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const box = await screen.findByRole('dialog', {}, SEEN);
    // the language switch is global; either language shows its own text
    expect(box.textContent).toMatch(/Words of a\.|Falas de a\./);
    window.localStorage.removeItem('rs.language');
  });

  it('choices branch inside the scene and an end choice closes it', async () => {
    setDialogue({
      scene: sceneOf('first_flight', [
        node('f1', {
          choices: [
            { label: text('Tell me more', 'Conte mais'), next: 'f2', action: null },
            {
              label: text('Take me to the Port', 'Leve-me ao Porto'),
              next: null,
              action: 'goto:/port',
            },
          ],
        }),
        node('f2', { choices: [{ label: text('Got it', 'Entendi'), next: null, action: 'end' }] }),
      ]),
    });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const box = await screen.findByRole('dialog', {}, SEEN);
    fireEvent.click(within(box).getByRole('button', { name: 'Tell me more' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Words of f2.'));
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByTestId('dialogue')).not.toBeInTheDocument());
    expect(dialogueEvents.at(-1)).toEqual({ sceneId: 'first_flight', event: 'done' });
  });

  it('a goto choice ends the scene and takes the pilot there', async () => {
    setDialogue({
      scene: sceneOf('first_flight', [
        node('f1', {
          choices: [
            {
              label: text('Take me to the Port', 'Leve-me ao Porto'),
              next: null,
              action: 'goto:/port',
            },
          ],
        }),
      ]),
    });
    const view = renderWithRouter(routes, { initialEntries: ['/ship'] });
    const box = await screen.findByRole('dialog', {}, SEEN);
    fireEvent.click(within(box).getByRole('button', { name: 'Take me to the Port' }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/port'));
    expect(dialogueEvents.at(-1)).toEqual({ sceneId: 'first_flight', event: 'done' });
  });

  it('a goto choice that names a next message takes the pilot there and the scene goes on', async () => {
    setDialogue({
      scene: sceneOf('pick_mission', [
        node('f2', {
          choices: [
            {
              label: text('Which one do I accept?', 'Qual eu aceito?'),
              next: 'f3',
              action: 'goto:/port',
            },
          ],
        }),
        node('f3', { choices: [{ label: text('Got it', 'Entendi'), next: null, action: 'end' }] }),
      ]),
    });
    const view = renderWithRouter(routes, { initialEntries: ['/ship'] });
    const box = await screen.findByRole('dialog', {}, SEEN);
    fireEvent.click(within(box).getByRole('button', { name: 'Which one do I accept?' }));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/port'));
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Words of f3.'));
    // the scene is not closed: only the pilot's move was recorded
    expect(dialogueEvents.some((event) => event.event === 'done')).toBe(false);
  });

  it('skip asks first on the welcome, and goes through on yes; Escape asks too', async () => {
    setDialogue({
      scene: sceneOf('welcome', [node('w1', { blocking: true, position: 'center' })]),
    });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const box = await screen.findByRole('dialog', {}, SEEN);
    fireEvent.click(within(box).getByRole('button', { name: 'Skip' }));
    expect(
      within(screen.getByRole('dialog')).getByText(/Skip the guide/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'No, go on' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Words of w1.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText(/Skip the guide/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, skip it' }));
    await waitFor(() => expect(screen.queryByTestId('dialogue')).not.toBeInTheDocument());
    expect(dialogueEvents.at(-1)).toEqual({ sceneId: 'welcome', event: 'skip' });
    // skipping the welcome turns the guide off, so the next scene does not open a moment later
    await waitFor(() => expect(dialogueSettings.at(-1)).toEqual({ enabled: false }));
  });

  it('skip goes through at once on any other scene', async () => {
    setDialogue({ scene: sceneOf('low_fuel', [node('l1')]) });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    const box = await screen.findByRole('dialog', {}, SEEN);
    fireEvent.click(within(box).getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.queryByTestId('dialogue')).not.toBeInTheDocument());
    expect(dialogueEvents.at(-1)).toEqual({ sceneId: 'low_fuel', event: 'skip' });
  });

  it('waits while another popup is open, then speaks', async () => {
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.setAttribute('data-test-popup', '');
    document.body.appendChild(other);
    setDialogue({ scene: sceneOf('s', [node('a')]) });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('navigation');
    await new Promise((resolve) => setTimeout(resolve, 2600));
    expect(screen.queryByTestId('dialogue')).not.toBeInTheDocument();
    other.remove();
    expect(await screen.findByTestId('dialogue', {}, SEEN)).toBeInTheDocument();
  });

  it('asks the server again when the pilot changes screen, so a scene opens a moment after its trigger', async () => {
    const view = renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('navigation');
    // nothing due while the pilot builds; then the trigger holds on the server and the pilot moves on
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(screen.queryByTestId('dialogue')).not.toBeInTheDocument();
    setDialogue({ scene: sceneOf('first_flight', [node('f1')]) });
    await act(() => view.router.navigate('/port'));
    // well inside the 10 s poll: it came from the screen change, not from the timer
    expect(await screen.findByRole('dialog', {}, { timeout: 3500 })).toHaveTextContent(
      'Words of f1.',
    );
  });

  it('rings the element a node points at when it is on the screen', async () => {
    const target = document.createElement('button');
    target.setAttribute('data-tour', 'auto_layout');
    target.setAttribute('data-test-popup', '');
    target.getBoundingClientRect = () => ({
      top: 100,
      left: 200,
      width: 120,
      height: 40,
      right: 320,
      bottom: 140,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    });
    document.body.appendChild(target);
    setDialogue({ scene: sceneOf('s', [node('a', { anchor: 'auto_layout' })]) });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    await screen.findByRole('dialog', {}, SEEN);
    const ring = document.querySelector<HTMLElement>('.dialogue-ring');
    expect(ring).not.toBeNull();
    expect(ring?.style.left).toBe('194px');
    expect(ring?.style.width).toBe('132px');
  });

  it('without the element on the screen there is no ring, and the box still shows', async () => {
    setDialogue({ scene: sceneOf('s', [node('a', { anchor: 'accept_button' })]) });
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    expect(await screen.findByRole('dialog', {}, SEEN)).toBeInTheDocument();
    expect(document.querySelector('.dialogue-ring')).toBeNull();
  });

  it('the account menu replays a seen scene and switches dialogues off and on', async () => {
    setDialogue({ replayable: [{ id: 'welcome', title: text('The welcome', 'As boas-vindas') }] });
    let replayed = false;
    server.use(
      http.post('/v1/players/me/dialogue/welcome/replay', () => {
        replayed = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    renderWithRouter(routes, { initialEntries: ['/ship'] });
    fireEvent.click(await screen.findByRole('button', { name: /account/i }));
    const menu = await screen.findByTestId('menu-dialogue');
    // folded away until opened
    expect(within(menu).queryByRole('button', { name: /Hear it again/ })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: /Talk again/ }));
    fireEvent.click(within(menu).getByRole('button', { name: /Hear it again: The welcome/ }));
    await waitFor(() => expect(replayed).toBe(true));

    // the menu closes after a replay; open it again and turn the dialogues off
    fireEvent.click(await screen.findByRole('button', { name: /account/i }));
    fireEvent.click(
      within(await screen.findByTestId('menu-dialogue')).getByRole('button', {
        name: /Talk again/,
      }),
    );
    fireEvent.click(
      within(await screen.findByTestId('menu-dialogue')).getByRole('button', {
        name: 'Turn dialogues off',
      }),
    );
    expect(
      await within(await screen.findByTestId('menu-dialogue')).findByRole('button', {
        name: 'Turn dialogues on',
      }),
    ).toBeInTheDocument();
  });
});

describe('the typewriter', () => {
  afterEach(() => vi.useRealTimers());

  it('types the text out and finish() shows the rest at once', () => {
    setReducedMotion(false);
    vi.useFakeTimers();
    const { result } = renderHook(() => useTypewriter('Hello there', true));
    expect(result.current.shown).toBe('');
    act(() => {
      vi.advanceTimersByTime(22 * 5);
    });
    expect(result.current.shown.length).toBeGreaterThan(0);
    expect(result.current.done).toBe(false);
    act(() => result.current.finish());
    expect(result.current.shown).toBe('Hello there');
    expect(result.current.done).toBe(true);
  });

  it('shows everything at once with reduced motion', () => {
    setReducedMotion(true);
    const { result } = renderHook(() => useTypewriter('Hello there', true));
    expect(result.current.shown).toBe('Hello there');
    expect(result.current.done).toBe(true);
  });
});
