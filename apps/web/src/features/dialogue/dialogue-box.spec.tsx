import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import type { ReactElement } from 'react';
import i18n from '../../i18n';
import type { DialogueNode } from '../../api/generated';
import { DialogueBox } from './dialogue-box';

const text = (value: string) => ({ en: value, 'pt-BR': value });
const node = (id: string, extra: Partial<DialogueNode> = {}): DialogueNode => ({
  id,
  text: text(`Words of ${id}.`),
  position: 'center',
  anchor: null,
  blocking: true,
  next: null,
  choices: [],
  ...extra,
});
const giver = {
  id: 'friend',
  name: 'Bob',
  title: text('Friend'),
  role: 'MENTOR' as const,
  factionId: 'luna',
  portraitUrl: null,
};
const noop = () => undefined;
const queryClient = new QueryClient();
const wrap = (ui: ReactElement) => (
  <I18nextProvider i18n={i18n}>
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  </I18nextProvider>
);
const box = (n: DialogueNode, key: string) =>
  wrap(
    <DialogueBox
      key={key}
      giver={giver}
      node={n}
      onContinue={noop}
      onChoose={noop}
      onSkip={noop}
    />,
  );

describe('the dimmed screen between lines', () => {
  it('stays dark from one blocking line to the next, even while the next waits to open', async () => {
    const view = render(box(node('a'), 'a'));
    expect(view.container.querySelector('.dialogue-backdrop')).not.toBeNull();
    expect(view.container.querySelector('.dialogue-backdrop.held')).toBeNull();

    // the next line comes after an open delay: the first box leaves, the dark stays
    view.rerender(box(node('b', { openDelay: 0.3 }), 'b'));
    expect(view.container.querySelector('.dialogue-backdrop.held')).not.toBeNull();
    expect(view.container.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    // opened: still handed over, so it does not fade in again
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(view.container.querySelector('.dialogue-backdrop.held')).not.toBeNull();
  });

  it('does not hold the dark for a line that does not dim the screen', () => {
    const view = render(box(node('a'), 'a'));
    view.rerender(box(node('b', { blocking: false }), 'b'));
    expect(view.container.querySelector('.dialogue-backdrop')).toBeNull();
  });
});
