import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/utils';
import i18n from '../../../i18n';
import { LossPopup } from './loss-popup';

describe('LossPopup', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    void i18n.changeLanguage('en');
  });

  it('lists lost and saved items and its only button continues', async () => {
    const onContinue = vi.fn();
    renderWithProviders(<LossPopup onContinue={onContinue} />);

    expect(screen.getByTestId('loss-title')).toHaveTextContent('Rescued');
    expect(screen.getByTestId('loss-lost')).toHaveTextContent('The ship');
    expect(screen.getByTestId('loss-lost')).toHaveTextContent('Its parts');
    expect(screen.getByTestId('loss-saved')).toHaveTextContent('You');
    expect(screen.getByTestId('loss-saved')).toHaveTextContent('Your credits');

    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(1);

    await userEvent.click(buttons[0]!);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('renders every line in pt-BR', () => {
    void i18n.changeLanguage('pt-BR');
    renderWithProviders(<LossPopup onContinue={vi.fn()} />);
    expect(screen.getByTestId('loss-title')).toHaveTextContent('Resgatado');
    expect(screen.getByTestId('loss-lost')).toHaveTextContent('A nave');
    expect(screen.getByTestId('loss-saved')).toHaveTextContent('Você');
  });
});
