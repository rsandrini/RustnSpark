import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Routes, Route } from 'react-router';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { EntityScreen } from './EntityScreen';

const materialsSchema = {
  entity: 'materials',
  fields: [
    {
      name: 'id',
      type: 'string',
      required: true,
      description: {
        en: 'Unique material id',
        'pt-BR': 'ID único do material',
      },
    },
    {
      name: 'displayName',
      type: 'locale-map',
      required: true,
      description: {
        en: 'Display name by locale',
        'pt-BR': 'Nome de exibição por idioma',
      },
    },
    {
      name: 'rarity',
      type: 'enum',
      required: true,
      enumValues: ['COMMON', 'RARE'],
      description: {
        en: 'Rarity tier',
        'pt-BR': 'Raridade',
      },
    },
    {
      name: 'basePrice',
      type: 'integer',
      required: true,
      min: 1,
      max: 1000000,
      description: {
        en: 'Base price',
        'pt-BR': 'Preço base',
      },
    },
    {
      name: 'fakeField',
      type: 'string',
      required: false,
      description: {
        en: 'Fake registered field',
        'pt-BR': 'Campo registrado falso',
      },
    },
  ],
};

const materialsRows = [
  {
    id: 'iron',
    displayName: { en: 'Iron', 'pt-BR': 'Ferro' },
    rarity: 'COMMON',
    basePrice: 10,
    fakeField: 'fake-value',
    active: true,
  },
];

describe('EntityScreen', () => {
  it('renders the entity list from schema and data', async () => {
    server.use(
      http.get('/v1/admin/tuning/schema/materials', () =>
        HttpResponse.json(materialsSchema, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/materials', () =>
        HttpResponse.json(materialsRows, { status: 200 }),
      ),
    );

    renderWithProviders(
      <MemoryRouter initialEntries={['/admin/tuning/entities/materials']}>
        <Routes>
          <Route path="/admin/tuning/entities/:entity" element={<EntityScreen />} />
        </Routes>
      </MemoryRouter>,
      { withRouter: false },
    );

    expect(await screen.findByText('iron')).toBeInTheDocument();
    expect(screen.getByText('COMMON')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('opens a create form generated from the schema', async () => {
    server.use(
      http.get('/v1/admin/tuning/schema/materials', () =>
        HttpResponse.json(materialsSchema, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/materials', () => HttpResponse.json([], { status: 200 })),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={['/admin/tuning/entities/materials']}>
        <Routes>
          <Route path="/admin/tuning/entities/:entity" element={<EntityScreen />} />
        </Routes>
      </MemoryRouter>,
      { withRouter: false },
    );

    await user.click(await screen.findByRole('button', { name: /create/i }));

    expect(screen.getByRole('textbox', { name: /id/i })).toBeInTheDocument();
    expect(
      screen.getByRole('textbox', { name: /display name by locale \(en\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /rarity/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /fake registered field/i })).toBeInTheDocument();
  });

  it('submits the create form to the API', async () => {
    const savedBodies: unknown[] = [];
    server.use(
      http.get('/v1/admin/tuning/schema/materials', () =>
        HttpResponse.json(materialsSchema, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/materials', () => HttpResponse.json([], { status: 200 })),
      http.post('/v1/admin/tuning/materials', async ({ request }) => {
        const body = await request.json();
        savedBodies.push(body);
        return HttpResponse.json(
          {
            row: {
              id: 'copper',
              displayName: { en: 'Copper', 'pt-BR': 'Cobre' },
              rarity: 'COMMON',
              basePrice: 15,
            },
            revision: {
              id: '1',
              actor: 'admin',
              entityType: 'materials',
              entityId: 'copper',
              before: null,
              after: {},
              reason: 'create',
              at: new Date().toISOString(),
            },
          },
          { status: 200 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={['/admin/tuning/entities/materials']}>
        <Routes>
          <Route path="/admin/tuning/entities/:entity" element={<EntityScreen />} />
        </Routes>
      </MemoryRouter>,
      { withRouter: false },
    );

    await user.click(await screen.findByRole('button', { name: /create/i }));

    await user.type(screen.getByRole('textbox', { name: /id/i }), 'copper');
    await user.type(
      screen.getByRole('textbox', { name: /display name by locale \(en\)/i }),
      'Copper',
    );
    await user.type(
      screen.getByRole('textbox', { name: /display name by locale \(pt-BR\)/i }),
      'Cobre',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: /rarity/i }), 'COMMON');
    await user.type(screen.getByRole('spinbutton', { name: /base price/i }), '15');
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'add copper');

    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(savedBodies.length).toBeGreaterThan(0);
    });

    const body = savedBodies[0] as Record<string, unknown>;
    expect(body).toMatchObject({
      data: {
        id: 'copper',
        displayName: { en: 'Copper', 'pt-BR': 'Cobre' },
        rarity: 'COMMON',
        basePrice: 15,
      },
    });
    expect(typeof body.reason).toBe('string');
  });

  it('retires an entity row with confirmation', async () => {
    let retired = false;
    server.use(
      http.get('/v1/admin/tuning/schema/materials', () =>
        HttpResponse.json(materialsSchema, { status: 200 }),
      ),
      http.get('/v1/admin/tuning/materials', () =>
        HttpResponse.json(materialsRows, { status: 200 }),
      ),
      http.delete('/v1/admin/tuning/materials/iron', () => {
        retired = true;
        return HttpResponse.json(
          {
            row: { ...materialsRows[0], active: false },
            revision: {
              id: '1',
              actor: 'admin',
              entityType: 'materials',
              entityId: 'iron',
              before: materialsRows[0],
              after: { ...materialsRows[0], active: false },
              reason: 'retire',
              at: new Date().toISOString(),
            },
          },
          { status: 200 },
        );
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(
      <MemoryRouter initialEntries={['/admin/tuning/entities/materials']}>
        <Routes>
          <Route path="/admin/tuning/entities/:entity" element={<EntityScreen />} />
        </Routes>
      </MemoryRouter>,
      { withRouter: false },
    );

    await screen.findByText('iron');
    await user.click(screen.getByRole('button', { name: /retire iron/i }));
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => {
      expect(retired).toBe(true);
    });
  });
});
