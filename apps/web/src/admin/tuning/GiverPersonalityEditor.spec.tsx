import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { GiverPersonalityEditor } from './GiverPersonalityEditor';

describe('GiverPersonalityEditor (admin, plan §3)', () => {
  it('shows every mission type translated, with the stored weight', () => {
    renderWithProviders(
      <GiverPersonalityEditor
        value={{ types: { DELIVERY: 60 }, minZone: 0, maxZone: 1, tone: 'gruff' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByText('Rescue')).toBeInTheDocument();
    expect(screen.getByTestId('giver-weight-DELIVERY')).toHaveValue(60);
    expect(screen.getByTestId('giver-weight-RESCUE')).toHaveValue(0); // absent = 0 shown
    expect(screen.getByTestId('giver-tone')).toHaveValue('gruff');
  });

  it('writes a type weight, keeping the rest of the personality', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <GiverPersonalityEditor
        value={{ types: { DELIVERY: 60 }, minZone: 0, maxZone: 1, tone: 'gruff' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId('giver-weight-RESCUE'), { target: { value: '10' } });
    expect(onChange).toHaveBeenCalledWith({
      types: { DELIVERY: 60, RESCUE: 10 },
      minZone: 0,
      maxZone: 1,
      tone: 'gruff',
    });
  });

  it('writes the zone band and the tone in the server shape', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <GiverPersonalityEditor
        value={{ types: {}, minZone: 0, maxZone: 1, tone: 'friendly' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId('giver-min-zone'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({
      types: {},
      minZone: 2,
      maxZone: 1,
      tone: 'friendly',
    });
    fireEvent.change(screen.getByTestId('giver-max-zone'), { target: { value: '3' } });
    expect(onChange).toHaveBeenLastCalledWith({
      types: {},
      minZone: 0,
      maxZone: 3,
      tone: 'friendly',
    });
    fireEvent.change(screen.getByTestId('giver-tone'), { target: { value: 'formal' } });
    expect(onChange).toHaveBeenLastCalledWith({
      types: {},
      minZone: 0,
      maxZone: 1,
      tone: 'formal',
    });
  });

  it('keeps an unknown owner-typed tone visible in the select instead of blank', () => {
    renderWithProviders(
      <GiverPersonalityEditor
        value={{ types: {}, minZone: 0, maxZone: 1, tone: 'smuggler' }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('giver-tone')).toHaveValue('smuggler');
  });
});
