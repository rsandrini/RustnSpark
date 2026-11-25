import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { MissionResultPopup, type MissionResultProps } from './mission-result-popup';

function setReducedMotion(reduced: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduced && query.includes('prefers-reduced-motion'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const format = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en')} ¢`;

function popup(over: Partial<MissionResultProps> = {}) {
  const props: MissionResultProps = {
    tone: 'ok',
    outcome: 'Mission accomplished',
    title: 'Ore run',
    route: 'A → B',
    credits: '+1,400 ¢',
    creditsValue: 1400,
    creditsFormat: format,
    race: null,
    onReport: () => undefined,
    ...over,
  };
  return render(
    <I18nextProvider i18n={i18n}>
      <MissionResultPopup {...props} />
    </I18nextProvider>,
  );
}

const css = readFileSync(resolve(__dirname, '../../styles/mission-result.css'), 'utf8');
const rule = (selector: string) =>
  css.match(new RegExp(`${selector.replace(/\./g, '\\.')}[^{]*\\{([^}]*)\\}`))?.[1] ?? '';

describe('MissionResultPopup reward moment', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const figure = () => document.querySelector('.mresult-credits')!;
  const root = () => document.querySelector('.mresult')!;

  it('holds the final text at once and counts the figure up from 0', () => {
    popup();
    expect(figure().querySelector('.sr-only')).toHaveTextContent('+1,400 ¢');
    expect(figure().querySelector('[aria-hidden="true"]')).toHaveTextContent('+0 ¢');
    expect(root()).toHaveAttribute('data-revealed', 'false');
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(figure().querySelector('[aria-hidden="true"]')).toHaveTextContent('+1,400 ¢');
  });

  it('staggers the secondary lines by 60 ms in order', () => {
    popup({ race: { place: 1, time: '1:02' } });
    const lines = [...document.querySelectorAll<HTMLElement>('[style*="--reveal-delay"]')];
    const delays = lines.map((el) => parseInt(el.style.getPropertyValue('--reveal-delay'), 10));
    expect(delays.length).toBe(2);
    expect(delays[1]! - delays[0]!).toBe(60);
  });

  it('a click on the body skips to the final state; the close button is never disabled', () => {
    popup();
    const button = screen.getByTestId('mission-result-report');
    expect(button).not.toBeDisabled();
    fireEvent.click(root());
    expect(root()).toHaveAttribute('data-revealed', 'true');
    expect(figure()).toHaveTextContent('+1,400 ¢');
    expect(figure().querySelector('[aria-hidden="true"]')).toBeNull();
    expect(button).not.toBeDisabled();
  });

  it('Escape still closes, whatever the reveal state', () => {
    const onReport = vi.fn();
    popup({ onReport });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onReport).toHaveBeenCalledOnce();
  });

  it('reduced motion renders the final state from the first render', () => {
    setReducedMotion(true);
    popup();
    expect(root()).toHaveAttribute('data-revealed', 'true');
    expect(figure()).toHaveTextContent('+1,400 ¢');
    expect(figure().querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('a gain pops, green', () => {
    popup();
    expect(figure()).toHaveClass('gain');
    expect(figure()).not.toHaveClass('loss');
  });

  it('a zero reward shows no count and no pop', () => {
    popup({ credits: '+0 ¢', creditsValue: 0 });
    expect(figure()).toHaveTextContent('+0 ¢');
    expect(figure().querySelector('[aria-hidden="true"]')).toBeNull();
    expect(figure()).not.toHaveClass('gain');
    expect(figure()).not.toHaveClass('loss');
  });

  it('a loss or a failed mission uses the loss style and no pop', () => {
    popup({ tone: 'bad', credits: '−200 ¢', creditsValue: -200 });
    expect(figure()).toHaveClass('loss');
    expect(figure()).not.toHaveClass('gain');
  });

  it('the stylesheet colours a gain green and a loss red, and the pop is motion-gated and glows green', () => {
    expect(rule('.mresult-credits.gain')).toMatch(/color:\s*var\(--ok\)/);
    expect(rule('.mresult-credits.loss')).toMatch(/color:\s*var\(--bad\)/);
    expect(rule('.mresult-credits.loss')).not.toMatch(/animation/);
    const gated =
      css.match(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(gated).toContain('mresult-pop');
    expect(css.match(/@keyframes mresult-pop \{[\s\S]*?\n\}/)?.[0]).toContain('var(--ok)');
    expect(css.replace(gated, '')).not.toMatch(/animation:[^;]*mresult-pop/);
  });

  it('tone bad with a positive credit uses the loss style', () => {
    popup({ tone: 'bad', credits: '+50 ¢', creditsValue: 50 });
    expect(figure()).toHaveClass('loss');
    expect(figure()).not.toHaveClass('gain');
  });

  it('buzzes once when it opens: success for a reward, warn for a loss, nothing for zero', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    popup();
    expect(vibrate.mock.calls).toEqual([[[20, 40, 30]]]);
    vibrate.mockClear();
    popup({ tone: 'bad', credits: '−200 ¢', creditsValue: -200 });
    expect(vibrate.mock.calls).toEqual([[40]]);
    vibrate.mockClear();
    popup({ credits: '+0 ¢', creditsValue: 0 });
    expect(vibrate).not.toHaveBeenCalled();
    delete (navigator as { vibrate?: unknown }).vibrate;
  });
});

describe('MissionResultPopup haptics in StrictMode', () => {
  afterEach(() => delete (navigator as { vibrate?: unknown }).vibrate);

  it('buzzes the reward once even when effects run twice', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    render(
      <StrictMode>
        <I18nextProvider i18n={i18n}>
          <MissionResultPopup
            tone="ok"
            outcome="Mission accomplished"
            title="Ore run"
            route="A → B"
            credits="+1,400 ¢"
            creditsValue={1400}
            creditsFormat={format}
            race={null}
            onReport={() => undefined}
          />
        </I18nextProvider>
      </StrictMode>,
    );
    expect(vibrate).toHaveBeenCalledTimes(1);
  });
});
