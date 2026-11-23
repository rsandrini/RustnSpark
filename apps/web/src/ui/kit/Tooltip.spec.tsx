import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from './Tooltip';
import { Gauge } from '../Gauge';
import { ResourceChip } from './ResourceChip';

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

  it('a second click on the trigger closes the open tooltip', () => {
    render(
      <Tooltip content="Tip">
        <button type="button">{THRUST}</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: THRUST });
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a click that follows the focus or hover that opened it keeps it open', () => {
    render(
      <Tooltip content="Tip">
        <button type="button">{THRUST}</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: THRUST });
    fireEvent.focus(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('align end anchors the card to the right edge; start is the default', () => {
    const { rerender } = render(
      <Tooltip content="Tip">
        <button type="button">{THRUST}</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: THRUST }));
    expect(screen.getByRole('tooltip')).not.toHaveClass('kit-tip-card--end');
    rerender(
      <Tooltip content="Tip" align="end">
        <button type="button">{THRUST}</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip')).toHaveClass('kit-tip-card--end');
  });

  it('describe false leaves the trigger without aria-describedby', () => {
    render(
      <Tooltip content="Tip" describe={false}>
        <button type="button">{THRUST}</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: THRUST });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('describes a Gauge child on the progressbar and opens from keyboard focus', () => {
    render(
      <Tooltip content="Fuel card">
        <Gauge value={5} max={10} label="5/10" ariaLabel="Fuel" tabIndex={0} />
      </Tooltip>,
    );
    const bar = screen.getByRole('progressbar', { name: 'Fuel' });
    expect(bar).toHaveAttribute('tabindex', '0');
    fireEvent.focus(bar);
    expect(bar.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  });

  it('describes a ResourceChip child on the chip root', () => {
    render(
      <Tooltip content="Wallet card" align="end">
        <ResourceChip label="Credits" value={5} testId="chip" tabIndex={0} />
      </Tooltip>,
    );
    const chip = screen.getByTestId('chip');
    expect(chip).toHaveAttribute('tabindex', '0');
    fireEvent.focus(chip);
    expect(chip.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  });
});
