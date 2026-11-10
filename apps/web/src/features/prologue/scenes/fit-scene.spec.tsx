import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/utils';
import i18n from '../../../i18n';
import {
  PROLOGUE_ENGINE,
  PROLOGUE_SHIP_START,
} from '../prologue-fixtures';
import { FitScene } from './fit-scene';

describe('FitScene', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows only the one part in the tray', () => {
    renderWithProviders(
      <FitScene ship={PROLOGUE_SHIP_START} part={PROLOGUE_ENGINE} onFitted={vi.fn()} />,
    );
    const buttons = screen.getAllByTestId('fit-part');
    expect(buttons.length).toBe(1);
    expect(buttons[0]).toHaveTextContent('Small Chemical Engine');
  });

  it('places the engine and calls onFitted when dropped on the correct cell', async () => {
    const onFitted = vi.fn();
    const { container } = renderWithProviders(
      <FitScene ship={PROLOGUE_SHIP_START} part={PROLOGUE_ENGINE} onFitted={onFitted} />,
    );

    const row = screen.getByTestId('fit-part');
    const svg = container.querySelector('.hangar-scene svg') as SVGSVGElement;
    // The engine target is (-4, 0). The yard view is centred on the layout; mock a 400px square.
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 400));
    const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, 20];
    const span = viewBox[2] ?? 20;
    const toClient = (cx: number, cy: number) => ({
      clientX: ((cx - (viewBox[0] ?? 0)) * 400) / span,
      clientY: ((cy - (viewBox[1] ?? 0)) * 400) / span,
    });

    fireEvent.pointerDown(row, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, toClient(-3.5, 0.5));
    await waitFor(() => expect(screen.getByTestId('drop-preview')).toHaveClass('ok'));
    fireEvent.pointerUp(window, toClient(-3.5, 0.5));

    await waitFor(() => expect(onFitted).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('fit-done')).toBeInTheDocument();
  });

  it('rejects an engine placed where it does not connect and shows the real problem text', async () => {
    const onFitted = vi.fn();
    const { container } = renderWithProviders(
      <FitScene ship={PROLOGUE_SHIP_START} part={PROLOGUE_ENGINE} onFitted={onFitted} />,
    );

    const row = screen.getByTestId('fit-part');
    fireEvent.click(row);
    const cell = container.querySelector('rect.yard-cell[data-gx="-4"][data-gy="-1"]');
    expect(cell).not.toBeNull();
    fireEvent.click(cell!);

    await waitFor(() => expect(screen.getByTestId('fit-problem')).toBeInTheDocument());
    expect(screen.getByTestId('fit-problem')).toHaveTextContent(
      'The part must touch a matching connector.',
    );
    expect(onFitted).not.toHaveBeenCalled();
  });

  it('opens the parts sheet at phone width and offers a tap-to-place path', async () => {
    const onFitted = vi.fn();
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 700px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { container } = renderWithProviders(
      <FitScene ship={PROLOGUE_SHIP_START} part={PROLOGUE_ENGINE} onFitted={onFitted} />,
    );

    const openButton = screen.getByTestId('fit-open-sheet');
    await userEvent.click(openButton);

    const sheet = container.querySelector('.phone-sheet.open');
    expect(sheet).not.toBeNull();

    const row = screen.getByTestId('fit-part');
    await userEvent.click(row);

    const cell = container.querySelector('rect.yard-cell[data-gx="-4"][data-gy="0"]');
    expect(cell).not.toBeNull();
    fireEvent.click(cell!);

    await waitFor(() => expect(onFitted).toHaveBeenCalledTimes(1));
  });
});
