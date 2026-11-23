import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from './Tooltip';

const THRUST = 'Thrust';

describe('Tooltip', () => {
  it('opens its content on focus and on click, is described by aria-describedby, closes on Escape', () => {
    render(
      <Tooltip content="Thrust moves the ship">
        <button type="button">{THRUST}</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: THRUST });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(trigger);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Thrust moves the ship');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
