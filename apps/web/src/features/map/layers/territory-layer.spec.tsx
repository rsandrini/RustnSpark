import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import i18n from '../../../i18n';
import { renderWithProviders } from '../../../test/utils';
import { TerritoryLayer } from './territory-layer';
import { territoriesOf } from '../territories';

const places = [
  { id: 'a', x: 0, y: 0, factionId: 'luna' },
  { id: 'b', x: 80, y: 0, factionId: 'luna' },
  { id: 'c', x: 300, y: 100, factionId: 'sun' },
  { id: 'd', x: 500, y: 500, factionId: 'free' },
];

function renderLayer() {
  return renderWithProviders(
    <svg>
      <TerritoryLayer territories={territoriesOf(places)} factions={{}} scale={1} />
    </svg>,
    { withRouter: false },
  );
}

describe('TerritoryLayer', () => {
  it('draws one area and one label per faction, none for the independent place', () => {
    const { container } = renderLayer();
    expect(container.querySelectorAll('circle.territory-area')).toHaveLength(2);
    const labels = Array.from(container.querySelectorAll('text.territory-label')).map(
      (text) => text.textContent,
    );
    expect(labels).toEqual(['LUNA AUTHORITY', 'SUN TRADERS']);
    expect(container.querySelector('[data-faction="free"]')).toBeNull();
  });

  it('names the faction in the player language', async () => {
    await act(() => i18n.changeLanguage('pt-BR'));
    try {
      const { container } = renderLayer();
      expect(container.querySelector('text.territory-label')?.textContent).toBe(
        i18n.t('factions.luna').toUpperCase(),
      );
    } finally {
      await act(() => i18n.changeLanguage('en'));
    }
  });
});
