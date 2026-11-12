import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/msw/server';
import { renderWithProviders } from '../../test/utils';
import { OpeningScript } from './OpeningScript';

const node = (id: string, en: string, ptBR: string) => ({
  id,
  text: { en, 'pt-BR': ptBR },
  position: 'center',
  anchor: null,
  blocking: true,
  next: null,
  choices: [],
});
const scene = (id: string, trigger: string, order: number, en: string, ptBR: string) => ({
  id,
  title: { en: id, 'pt-BR': id },
  trigger,
  order,
  start: `${id}-1`,
  nodes: [node(`${id}-1`, en, ptBR)],
});

describe('the opening script in the Admin', () => {
  it('lists every line of the opening guides in the order it is told, and finds a phrase in either language', async () => {
    server.use(
      http.get('/v1/admin/tuning/quest-givers', () =>
        HttpResponse.json([
          {
            id: 'free_mentor_oren',
            name: 'Marshal Oren',
            factionId: 'free',
            scenes: [
              scene('o1', 'prologue_rescue_done', 1, 'Choose who you fight with', 'Escolha'),
            ],
          },
          {
            id: 'free_mentor_kite',
            name: 'Kite',
            factionId: 'free',
            scenes: [
              scene('k2', 'prologue_race_leg_1', 1, 'First leg down', 'Primeiro trecho'),
              scene('k1', 'prologue_gift_enter', 1, 'I am Kite', 'Sou o Kite'),
            ],
          },
          {
            id: 'luna_mentor_ines',
            name: 'Ines',
            factionId: 'luna',
            scenes: [scene('l1', 'onboarded', 1, 'Welcome to Luna', 'Bem-vindo')],
          },
        ]),
      ),
    );
    renderWithProviders(<OpeningScript />);

    const rows = await screen.findAllByRole('row');
    // header + the three opening scenes (the Luna mentor is not part of the opening)
    expect(rows).toHaveLength(4);
    const text = rows.slice(1).map((row) => within(row).getAllByRole('cell')[3]!.textContent);
    expect(text).toEqual(['I am Kite', 'First leg down', 'Choose who you fight with']);
    expect(within(rows[1]!).getAllByRole('cell')[0]).toHaveTextContent('1');
    expect(within(rows[1]!).getAllByRole('cell')[2]).toHaveTextContent('Kite');
    expect(screen.queryByText('Welcome to Luna')).toBeNull();

    // a phrase in the other language still finds its row
    fireEvent.change(screen.getByLabelText('Search the script…'), {
      target: { value: 'primeiro' },
    });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('First leg down')).toBeInTheDocument();
  });
});
