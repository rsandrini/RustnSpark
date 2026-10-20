import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { GIVER_POOL_KEYS, GiverLinesEditor } from './GiverLinesEditor';

describe('GiverLinesEditor (admin, plan §4/§5)', () => {
  it('renders a section for every known pool key, even when empty', () => {
    renderWithProviders(<GiverLinesEditor value={{}} onChange={vi.fn()} />);
    for (const key of GIVER_POOL_KEYS) {
      expect(screen.getByTestId(`giver-pool-${key}`)).toBeInTheDocument();
    }
    // Every empty pool shows the fallback hint (one per section).
    expect(screen.getAllByText(/the template description is used/)).toHaveLength(
      GIVER_POOL_KEYS.length,
    );
  });

  it('shows the stored lines in both languages and writes an edit back, keeping unknown keys', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <GiverLinesEditor
        value={{
          'offer.delivery': [{ en: 'Cargo needs a pilot.', 'pt-BR': 'A carga precisa de piloto.' }],
          house_rules: [{ en: 'Keep me.', 'pt-BR': 'Me mantenha.' }],
        }}
        onChange={onChange}
      />,
    );
    const en = screen.getByTestId('giver-line-offer.delivery-0-en');
    const pt = screen.getByTestId('giver-line-offer.delivery-0-pt');
    expect(en).toHaveValue('Cargo needs a pilot.');
    expect(pt).toHaveValue('A carga precisa de piloto.');
    fireEvent.change(en, { target: { value: 'Fresh cargo waiting.' } });
    expect(onChange).toHaveBeenCalledWith({
      'offer.delivery': [{ en: 'Fresh cargo waiting.', 'pt-BR': 'A carga precisa de piloto.' }],
      house_rules: [{ en: 'Keep me.', 'pt-BR': 'Me mantenha.' }],
    });
  });

  it('adds a bilingual line to a pool', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <GiverLinesEditor value={{ accepted: [{ en: 'Aye.', 'pt-BR': 'Sim.' }] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('giver-add-accepted'));
    expect(onChange).toHaveBeenCalledWith({
      accepted: [
        { en: 'Aye.', 'pt-BR': 'Sim.' },
        { en: '', 'pt-BR': '' },
      ],
    });
  });

  it('removes a line and drops the pool key when the last one goes', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <GiverLinesEditor value={{ first_flight: [{ en: 'Test hop.', 'pt-BR': 'Voo de teste.' }] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('giver-remove-first_flight-0'));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
