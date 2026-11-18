import { describe, it, expect } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { ShowcaseBlock } from './landing-showcase';
import i18n from '../../i18n';

describe('ShowcaseBlock', () => {
  it('renders the build showcase with image, pins and legend', () => {
    renderWithProviders(<ShowcaseBlock id="build" />);

    expect(
      screen.getByRole('heading', { name: 'Your ship is a puzzle of parts' }),
    ).toBeInTheDocument();

    const image = screen.getByRole('img', {
      name: 'The ship builder: a ship laid out on a grid of parts, with its sheet on the right',
    });
    expect(image).toHaveAttribute('src', '/landing/ship-builder.webp');
    expect(image).toHaveAttribute('width', '1280');
    expect(image).toHaveAttribute('height', '719');

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Fit every part on the grid')).toBeInTheDocument();
    expect(screen.getByText('The ship becomes a class')).toBeInTheDocument();
    expect(screen.getByText('Read it at a glance')).toBeInTheDocument();

    const pins = screen.getAllByText(/^[123]$/).filter((el) =>
      el.classList.contains('landing-pin'),
    );
    expect(pins).toHaveLength(3);
  });

  it('renders the race showcase with image, pins and legend', () => {
    renderWithProviders(<ShowcaseBlock id="race" />);

    expect(screen.getByRole('heading', { name: 'Pick a job. Beat the field.' })).toBeInTheDocument();

    const image = screen.getByRole('img', {
      name: 'A race mission: the field of rivals, the route on a map and the ship in flight',
    });
    expect(image).toHaveAttribute('src', '/landing/race.webp');
    expect(image).toHaveAttribute('width', '1280');
    expect(image).toHaveAttribute('height', '1026');

    expect(screen.getByText('Know the field')).toBeInTheDocument();
    expect(screen.getByText('Check the fuel')).toBeInTheDocument();
    expect(screen.getByText('Watch it fly')).toBeInTheDocument();

    const pins = screen.getAllByText(/^[123]$/).filter((el) =>
      el.classList.contains('landing-pin'),
    );
    expect(pins).toHaveLength(3);
  });

  it('renders in pt-BR when the language is switched', async () => {
    await act(async () => {
      await i18n.changeLanguage('pt-BR');
    });
    renderWithProviders(<ShowcaseBlock id="build" />);

    expect(
      screen.getByRole('heading', { name: 'Sua nave é um quebra-cabeça de peças' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Your ship is a puzzle of parts' }),
    ).not.toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });
});
