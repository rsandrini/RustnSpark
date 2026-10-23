import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ReportTextEditor, previewOf, unknownTokens } from './ReportTextEditor';

vi.mock('./tuning.api', () => ({
  tuningApi: {
    getEntitySchema: () =>
      Promise.resolve({
        entity: 'report-templates',
        fields: [],
        placeholders: { leg_travel: ['distance'] },
      }),
  },
}));

const value = { en: ['A run of {distance}.'], 'pt-BR': ['Um trecho de {distance}.'] };

describe('ReportTextEditor (admin)', () => {
  it('shows the lines of both languages with a preview and the placeholders the event can print', async () => {
    renderWithProviders(<ReportTextEditor value={value} rowId="leg_travel" onChange={vi.fn()} />);
    expect(screen.getByTestId('report-line-en-0')).toHaveValue('A run of {distance}.');
    expect(screen.getByTestId('report-line-pt-BR-0')).toHaveValue('Um trecho de {distance}.');
    expect(screen.getByText('A run of 420.')).toBeInTheDocument();
    expect(await screen.findByText('{distance}')).toBeInTheDocument();
  });

  it('writes an edit, an added line and a removed line back', () => {
    const onChange = vi.fn();
    renderWithProviders(<ReportTextEditor value={value} rowId="leg_travel" onChange={onChange} />);
    fireEvent.change(screen.getByTestId('report-line-en-0'), {
      target: { value: 'New {distance}.' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ ...value, en: ['New {distance}.'] });
    fireEvent.click(screen.getByTestId('report-add-pt-BR'));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, 'pt-BR': [...value['pt-BR'], ''] });
    fireEvent.click(screen.getByTestId('report-remove-en-0'));
    expect(onChange).toHaveBeenLastCalledWith({ ...value, en: [] });
  });

  it('flags a placeholder the event does not carry', async () => {
    renderWithProviders(
      <ReportTextEditor
        value={{ en: ['Hit {part}.'], 'pt-BR': ['x'] }}
        rowId="leg_travel"
        onChange={vi.fn()}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('{part}');
  });

  it('fills the sample values and finds unknown tokens', () => {
    expect(previewOf('{credits} for {part}')).toBe('+1200 for Ion Engine');
    expect(unknownTokens('{a} {distance}', ['distance'])).toEqual(['a']);
  });
});
