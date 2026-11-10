import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/utils';
import { RaceScene } from './race-scene';

describe('RaceScene', () => {
  it('always ends with the friend first and the player second and never reads a random source', async () => {
    const onDone = vi.fn();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    renderWithProviders(<RaceScene legSeconds={[15, 20, 30]} prize={600} onDone={onDone} />);

    // Let the initial data queries settle (MSW uses Math.random for request ids, which is not ours).
    await waitFor(() => expect(screen.getByTestId('race-table')).toBeInTheDocument());
    randomSpy.mockClear();

    // Skip the three legs.
    for (let i = 0; i < 3; i += 1) {
      await userEvent.click(screen.getByTestId('race-skip'));
    }

    const rows = screen.getAllByTestId('race-standing-row');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toHaveTextContent('Kite');
    expect(rows[1]).toHaveTextContent('you');
    expect(randomSpy).not.toHaveBeenCalled();

    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('race-continue'));
    expect(onDone).toHaveBeenCalledTimes(1);

    randomSpy.mockRestore();
  });

  it('shows the player prize equal to the prize prop', async () => {
    renderWithProviders(<RaceScene legSeconds={[15, 20, 30]} prize={750} onDone={vi.fn()} />);
    for (let i = 0; i < 3; i += 1) {
      await userEvent.click(screen.getByTestId('race-skip'));
    }
    expect(screen.getByTestId('race-prize')).toHaveTextContent('750');
  });

  it('counts legs while the race is running', async () => {
    renderWithProviders(<RaceScene legSeconds={[15, 20, 30]} prize={600} onDone={vi.fn()} />);
    expect(screen.getByTestId('race-leg-count')).toHaveTextContent('1');
    await userEvent.click(screen.getByTestId('race-skip'));
    expect(screen.getByTestId('race-leg-count')).toHaveTextContent('2');
  });
});
