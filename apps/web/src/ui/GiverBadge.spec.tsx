import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/msw/server';
import { renderWithProviders } from '../test/utils';
import { GiverBadge } from './GiverBadge';

describe('GiverBadge (quest givers)', () => {
  it('shows the uploaded portrait with the name and the localized title', () => {
    renderWithProviders(
      <GiverBadge name="Ines Moura" title="Dockmaster" portraitUrl="/art/ines.png" factionId="luna" />,
    );
    const portrait = document.querySelector('.giver-portrait');
    expect(portrait).toHaveAttribute('src', '/art/ines.png');
    expect(screen.getByText('Ines Moura')).toBeInTheDocument();
    expect(screen.getByText('Dockmaster')).toBeInTheDocument();
    expect(document.querySelector('.giver-fac')).toBeNull();
  });

  it('falls back to the faction-symbol placeholder when there is no portrait', () => {
    renderWithProviders(<GiverBadge name="Old Vik" title={null} factionId="sun" />);
    expect(document.querySelector('.giver-portrait')).toBeNull();
    // The default /v1/factions mock has no uploaded logo: the initial stands in, on the
    // faction colour class (the server colour overrides it inline once the query lands).
    const disc = document.querySelector('.giver-fac');
    expect(disc?.classList.contains('sun')).toBe(true);
    expect(disc?.textContent).toBe('O');
    expect(screen.getByText('Old Vik')).toBeInTheDocument();
  });

  it('uses the uploaded faction logo as the placeholder symbol when there is one', async () => {
    server.use(
      http.get('/v1/factions', () =>
        HttpResponse.json({
          factions: [
            {
              id: 'luna',
              displayName: { en: 'Luna', 'pt-BR': 'Luna' },
              description: { en: '', 'pt-BR': '' },
              color: '#4a90d9',
              playable: true,
              art: { banner: null, logo: '/art/luna-symbol.png', background: null },
            },
          ],
        }),
      ),
    );
    renderWithProviders(<GiverBadge name="Tomas" factionId="luna" size="card" />);
    // The factions query lands after the first paint (initial placeholder first, logo after).
    await waitFor(() =>
      expect(document.querySelector('.giver-fac-logo')).toHaveAttribute(
        'src',
        '/art/luna-symbol.png',
      ),
    );
    expect(document.querySelector('.giver-badge.card')).not.toBeNull();
    expect(document.querySelector('.giver-title')).toBeNull(); // no title → nothing rendered
  });
});
