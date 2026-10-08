import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { ConnectorRulesEditor, type ConnectorRules } from './ConnectorRulesEditor';

const central: ConnectorRules = {
  sides: {
    N: [{ kind: 'central', weight: 100 }],
    E: [{ kind: 'central', weight: 100 }],
    S: [{ kind: 'central', weight: 100 }],
    W: [{ kind: 'none', weight: 100 }],
  },
};

const previewOk = {
  problem: null,
  combos: [
    { sides: { N: 'central', E: 'central', S: 'central', W: 'none' }, probability: 0.6 },
    { sides: { N: 'split', E: 'split', S: 'split', W: 'none' }, probability: 0.4 },
  ],
  samples: [{ cells: [{ dx: 0, dy: 0, side: 'N', kind: 'central' }] }],
};

describe('ConnectorRulesEditor', () => {
  it('renders without a stored value, says it is not configured and offers presets', () => {
    renderWithProviders(<ConnectorRulesEditor value={null} onChange={vi.fn()} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
    expect(screen.getByTestId('rules-preset-mixed')).toBeInTheDocument();
    expect(screen.queryByTestId('rules-weight-N-central')).toBeNull(); // nothing allowed yet
  });

  it('shows allowed kinds as pressed chips with their weight and toggles a kind on and off', () => {
    const onChange = vi.fn();
    renderWithProviders(<ConnectorRulesEditor value={central} onChange={onChange} />);
    expect(screen.getByTestId('rules-chip-N-central')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('rules-weight-N-central')).toHaveValue(100);
    expect(screen.getByTestId('rules-chip-N-split')).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByTestId('rules-chip-N-split'));
    expect((onChange.mock.calls[0]![0] as ConnectorRules).sides.N).toEqual([
      { kind: 'central', weight: 100 },
      { kind: 'split', weight: 1 },
    ]);

    fireEvent.click(screen.getByTestId('rules-chip-N-central'));
    expect((onChange.mock.calls[1]![0] as ConnectorRules).sides.N).toEqual([]);
  });

  it('edits a weight', () => {
    const onChange = vi.fn();
    renderWithProviders(<ConnectorRulesEditor value={central} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('rules-weight-N-central'), { target: { value: '30' } });
    expect((onChange.mock.calls[0]![0] as ConnectorRules).sides.N).toEqual([
      { kind: 'central', weight: 30 },
    ]);
  });

  it('locks the facing side W of an engine/weapon to none', () => {
    renderWithProviders(
      <ConnectorRulesEditor value={central} onChange={vi.fn()} partClass="ENGINE" />,
    );
    expect(screen.getByTestId('rules-chip-W-central')).toBeDisabled();
    expect(screen.getByTestId('rules-chip-W-universal')).toBeDisabled();
    expect(screen.getByText(/facing side: always none/i)).toBeInTheDocument();
    // a non-directional part keeps W free
    renderWithProviders(<ConnectorRulesEditor value={central} onChange={vi.fn()} partClass="TANK" />);
    expect(screen.getAllByTestId('rules-chip-W-central')[1]).toBeEnabled();
  });

  it('presets: "mixed" is one kind per part; engines/weapons keep W at none', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ConnectorRulesEditor value={central} onChange={onChange} partClass="WEAPON" />,
    );
    fireEvent.click(screen.getByTestId('rules-preset-mixed'));
    const mixed = onChange.mock.calls[0]![0] as ConnectorRules;
    expect(mixed.oneKindPerPart).toBe(true);
    expect(mixed.sides.N.map((entry) => entry.kind)).toEqual(['central', 'split', 'universal']);
    expect(mixed.sides.W).toEqual([{ kind: 'none', weight: 1 }]);

    fireEvent.click(screen.getByTestId('rules-preset-central'));
    const allCentral = onChange.mock.calls[1]![0] as ConnectorRules;
    expect(allCentral.oneKindPerPart).toBeUndefined();
    expect(allCentral.sides.E).toEqual([{ kind: 'central', weight: 1 }]);
  });

  it('toggles one kind per part and sets/clears the caps', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <ConnectorRulesEditor value={{ ...central, maxSplit: 1 }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('rules-oneKindPerPart'));
    expect((onChange.mock.calls[0]![0] as ConnectorRules).oneKindPerPart).toBe(true);
    fireEvent.change(screen.getByTestId('rules-maxConnected'), { target: { value: '3' } });
    expect((onChange.mock.calls[1]![0] as ConnectorRules).maxConnected).toBe(3);
    fireEvent.change(screen.getByTestId('rules-maxSplit'), { target: { value: '' } });
    expect('maxSplit' in (onChange.mock.calls[2]![0] as ConnectorRules)).toBe(false);
  });

  it('adds, edits and removes a forbidden combination', () => {
    const onChange = vi.fn();
    const first = renderWithProviders(<ConnectorRulesEditor value={central} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add forbidden/i }));
    expect((onChange.mock.calls[0]![0] as ConnectorRules).forbidden).toEqual([{}]);
    first.unmount();

    const second = renderWithProviders(
      <ConnectorRulesEditor value={{ ...central, forbidden: [{}] }} onChange={onChange} />,
    );
    fireEvent.change(screen.getByTestId('rules-forbidden-0-N'), { target: { value: 'split' } });
    expect((onChange.mock.calls[1]![0] as ConnectorRules).forbidden).toEqual([{ N: 'split' }]);
    second.unmount();

    renderWithProviders(
      <ConnectorRulesEditor value={{ ...central, forbidden: [{ N: 'split' }] }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
    expect('forbidden' in (onChange.mock.calls[2]![0] as ConnectorRules)).toBe(false);
  });

  it('previews what will be generated: each combination with its chance, plus sample parts', async () => {
    let asked: Record<string, unknown> | null = null;
    server.use(
      http.post('/v1/admin/tuning/connector-rules/preview', async ({ request }) => {
        asked = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(previewOk);
      }),
    );
    renderWithProviders(
      <ConnectorRulesEditor value={central} onChange={vi.fn()} w={2} h={1} partClass="CARGO" />,
    );
    const combos = await screen.findByTestId('rules-combos');
    expect(within(combos).getByText('60%')).toBeInTheDocument();
    expect(within(combos).getByText('40%')).toBeInTheDocument();
    expect(within(screen.getByTestId('rules-samples')).getAllByTestId('connector-grid')).toHaveLength(1);
    expect(asked).toMatchObject({ w: 2, h: 1, partClass: 'CARGO' });
  });

  it('shows the server\'s reason when the rules cannot generate anything', async () => {
    server.use(
      http.post('/v1/admin/tuning/connector-rules/preview', () =>
        HttpResponse.json({ problem: 'no side combination satisfies the weights', combos: [], samples: [] }),
      ),
    );
    renderWithProviders(<ConnectorRulesEditor value={central} onChange={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByTestId('rules-problem')).toHaveTextContent(/no side combination/),
    );
  });
});
