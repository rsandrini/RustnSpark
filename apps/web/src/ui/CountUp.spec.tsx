import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../i18n';
import { CountUp } from './CountUp';

describe('CountUp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await i18n.changeLanguage('en');
  });

  const view = (value: number, unit?: string) => (
    <I18nextProvider i18n={i18n}>
      <CountUp value={value} unit={unit} animateOnMount />
    </I18nextProvider>
  );

  it('hides the counting text and holds the final text at once for assistive tech', () => {
    const { container } = render(view(1234, '¢'));
    const hidden = container.querySelector('[aria-hidden="true"]')!;
    expect(hidden).toHaveTextContent('0 ¢');
    expect(container.querySelector('.sr-only')).toHaveTextContent('1,234 ¢');
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(hidden).toHaveTextContent('1,234 ¢');
  });

  it('formats by locale', async () => {
    await act(async () => {
      await i18n.changeLanguage('pt-BR');
    });
    const { container } = render(view(1234));
    expect(container.querySelector('.sr-only')).toHaveTextContent('1.234');
  });
});
