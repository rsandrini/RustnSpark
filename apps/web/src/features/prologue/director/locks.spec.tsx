import { afterEach, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { useOpeningLocks } from './locks';

function Screen({ allow }: { allow: readonly string[] }) {
  useOpeningLocks(allow, true);
  return (
    <div>
      <button type="button" aria-label="elsewhere" />
      <div className="hud">
        <div role="progressbar" tabIndex={0} aria-label="Fuel" />
      </div>
      <div className="board-faults">
        <button type="button" className="kit-blocker" aria-label="No engine" />
      </div>
      <button type="button" className="mine" aria-label="allowed" />
    </div>
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useOpeningLocks', () => {
  it('locks what the step does not allow, but never the HUD or the ship-fault chips', async () => {
    const view = render(<Screen allow={['.mine']} />);
    const elsewhere = view.getByRole('button', { name: 'elsewhere' });
    await waitFor(() => expect(elsewhere).toHaveAttribute('data-opening-locked'));
    expect(view.getByRole('button', { name: 'No engine' })).not.toHaveAttribute(
      'data-opening-locked',
    );
    expect(view.getByRole('button', { name: 'allowed' })).not.toHaveAttribute(
      'data-opening-locked',
    );
    expect(view.container.querySelector('.hud [data-opening-locked]')).toBeNull();
    expect(view.getByRole('progressbar')).not.toHaveAttribute('inert');
  });
});
