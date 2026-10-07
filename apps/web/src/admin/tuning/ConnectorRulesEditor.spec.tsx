import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ConnectorRulesEditor, type ConnectorRules } from './ConnectorRulesEditor';

const central: ConnectorRules = {
  sides: {
    N: [{ kind: 'central', weight: 100 }],
    E: [{ kind: 'central', weight: 100 }],
    S: [{ kind: 'central', weight: 100 }],
    W: [{ kind: 'none', weight: 100 }],
  },
};

describe('ConnectorRulesEditor', () => {
  it('renders without a stored value and says the type is not configured', () => {
    renderWithProviders(<ConnectorRulesEditor value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(screen.getByTestId('rules-weight-N-central')).toHaveValue(0);
  });

  it('shows the stored weights and emits an updated rule set on edit', () => {
    const onChange = vi.fn();
    renderWithProviders(<ConnectorRulesEditor value={central} onChange={onChange} />);
    expect(screen.getByTestId('rules-weight-N-central')).toHaveValue(100);
    fireEvent.change(screen.getByTestId('rules-weight-N-split'), { target: { value: '30' } });
    const next = onChange.mock.calls[0]![0] as ConnectorRules;
    expect(next.sides.N).toEqual([
      { kind: 'central', weight: 100 },
      { kind: 'split', weight: 30 },
    ]);
    expect(next.sides.W).toEqual(central.sides.W);
  });

  it('drops a kind when its weight goes to 0', () => {
    const onChange = vi.fn();
    renderWithProviders(<ConnectorRulesEditor value={central} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('rules-weight-N-central'), { target: { value: '0' } });
    expect((onChange.mock.calls[0]![0] as ConnectorRules).sides.N).toEqual([]);
  });

  it('sets and clears the caps', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ConnectorRulesEditor value={{ ...central, maxSplit: 1 }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId('rules-maxConnected'), { target: { value: '3' } });
    expect((onChange.mock.calls[0]![0] as ConnectorRules).maxConnected).toBe(3);
    fireEvent.change(screen.getByTestId('rules-maxSplit'), { target: { value: '' } });
    expect('maxSplit' in (onChange.mock.calls[1]![0] as ConnectorRules)).toBe(false);
  });

  it('adds, edits and removes a forbidden combination', () => {
    const onChange = vi.fn();
    const { rerender } = renderWithProviders(
      <ConnectorRulesEditor value={central} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add forbidden/i }));
    expect((onChange.mock.calls[0]![0] as ConnectorRules).forbidden).toEqual([{}]);

    rerender(<ConnectorRulesEditor value={{ ...central, forbidden: [{}] }} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('rules-forbidden-0-N'), { target: { value: 'split' } });
    expect((onChange.mock.calls[1]![0] as ConnectorRules).forbidden).toEqual([{ N: 'split' }]);

    rerender(
      <ConnectorRulesEditor value={{ ...central, forbidden: [{ N: 'split' }] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect('forbidden' in (onChange.mock.calls[2]![0] as ConnectorRules)).toBe(false);
  });
});
