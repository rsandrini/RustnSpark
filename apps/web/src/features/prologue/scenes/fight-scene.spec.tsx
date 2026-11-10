import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/utils';
import i18n from '../../../i18n';
import { FightScene } from './fight-scene';

describe('FightScene', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    void i18n.changeLanguage('en');
  });

  it('plays the same fixed log every time', async () => {
    const onDone = vi.fn();
    renderWithProviders(<FightScene onDone={onDone} />);

    const events = screen.getAllByTestId('fight-event');
    expect(events).toHaveLength(3);
    expect(events[0]).toHaveTextContent('Pirate ships drop out of the dust cloud.');
    expect(events[1]).toHaveTextContent('Kite');
    expect(events[2]).toHaveTextContent('Your ship is torn open');

    await userEvent.click(screen.getByTestId('fight-continue'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('renders every line in pt-BR', () => {
    void i18n.changeLanguage('pt-BR');
    renderWithProviders(<FightScene onDone={vi.fn()} />);
    const events = screen.getAllByTestId('fight-event');
    expect(events[0]).toHaveTextContent('nuvens de poeira');
    expect(events[1]).toHaveTextContent('Kite');
    expect(events[2]).toHaveTextContent('Sua nave');
  });
});
