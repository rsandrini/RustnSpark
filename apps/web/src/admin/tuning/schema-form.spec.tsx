import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { SchemaForm } from './SchemaForm';
import type { EntitySchemaField } from '../../api/generated';

const fakeFields: EntitySchemaField[] = [
  {
    name: 'name',
    type: 'string',
    required: true,
    description: {
      en: 'Name',
      'pt-BR': 'Nome',
    },
  },
  {
    name: 'count',
    type: 'integer',
    required: true,
    min: 0,
    max: 100,
    description: {
      en: 'Count',
      'pt-BR': 'Quantidade',
    },
  },
  {
    name: 'kind',
    type: 'enum',
    required: true,
    enumValues: ['A', 'B'],
    description: {
      en: 'Kind',
      'pt-BR': 'Tipo',
    },
  },
  {
    name: 'metadata',
    type: 'json',
    required: false,
    description: {
      en: 'Metadata',
      'pt-BR': 'Metadados',
    },
  },
  {
    name: 'displayName',
    type: 'locale-map',
    required: true,
    description: {
      en: 'Display name',
      'pt-BR': 'Nome de exibição',
    },
  },
  {
    name: 'registeredField',
    type: 'string',
    required: false,
    description: {
      en: 'Registered field',
      'pt-BR': 'Campo registrado',
    },
  },
];

describe('SchemaForm', () => {
  it('renders inputs for every field type in the schema', () => {
    renderWithProviders(<SchemaForm fields={fakeFields} onSubmit={vi.fn()} />);

    expect(screen.getByRole('textbox', { name: /^name$/i })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /count/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /kind/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /metadata/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /display name \(en\)/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /display name \(pt-BR\)/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /registered field/i })).toBeInTheDocument();
  });

  it('submits parsed values', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SchemaForm fields={fakeFields} onSubmit={onSubmit} />);

    await user.type(screen.getByRole('textbox', { name: /^name$/i }), 'test');
    await user.type(screen.getByRole('spinbutton', { name: /count/i }), '7');
    await user.selectOptions(screen.getByRole('combobox', { name: /kind/i }), 'B');
    await user.type(screen.getByRole('textbox', { name: /display name \(en\)/i }), 'Test');
    await user.type(screen.getByRole('textbox', { name: /display name \(pt-BR\)/i }), 'Teste');
    await user.click(screen.getByRole('textbox', { name: /metadata/i }));
    await user.paste('{"foo":1}');
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'test reason');

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test',
        count: 7,
        kind: 'B',
        displayName: { en: 'Test', 'pt-BR': 'Teste' },
        metadata: { foo: 1 },
      }),
      expect.any(String),
    );
  });

  it('shows field descriptions and bounds', () => {
    renderWithProviders(<SchemaForm fields={fakeFields} onSubmit={vi.fn()} />);

    expect(screen.getByText(/0 – 100/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\(required\)/i).length).toBeGreaterThan(0);
  });

  // Bug: a part with no stored connectorLayouts/cells (null in the DB, e.g. the bridge) crashed
  // the whole admin app — buildInitialValues defaulted every non-boolean/locale-map field to ''
  // for a missing value, and ConnectorLayoutEditor/GridCellsEditor's `value ?? fallback` doesn't
  // catch a non-nullish empty string, so `''.map` threw past React Router's error boundary.
  it('renders connector-layout and grid-cells fields when the stored value is null', () => {
    const fieldsWithNullableWidgets: EntitySchemaField[] = [
      ...fakeFields,
      {
        name: 'connectorLayouts',
        type: 'connector-layout',
        required: false,
        description: { en: 'Connector layouts', 'pt-BR': 'Layouts de conector' },
      },
      {
        name: 'cells',
        type: 'grid-cells',
        required: false,
        description: { en: 'Cells', 'pt-BR': 'Células' },
      },
    ];

    expect(() =>
      renderWithProviders(
        <SchemaForm
          fields={fieldsWithNullableWidgets}
          initialData={{ connectorLayouts: null, cells: null }}
          onSubmit={vi.fn()}
        />,
      ),
    ).not.toThrow();
  });
});
