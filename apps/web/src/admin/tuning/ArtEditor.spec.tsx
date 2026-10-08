import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { FactionBadge } from '../../ui/FactionBadge';
import { ArtEditor } from './ArtEditor';

describe('ArtEditor (factions)', () => {
  it('shows the built-in banner as the default and nothing for logo/background until uploaded', () => {
    renderWithProviders(<ArtEditor kind="factions" id="luna" />);
    const banner = screen.getByTestId('art-slot-banner');
    expect(within(banner).getByRole('img')).toHaveAttribute('src', '/factions/luna.wide.svg');
    expect(within(banner).getByText('Using the built-in default')).toBeInTheDocument();
    expect(within(screen.getByTestId('art-slot-logo')).getByText('No image')).toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'Reset to default' })).toBeNull();
  });

  it('uploads a picked file as raw image bytes and refreshes', async () => {
    let seen: { slot: string; type: string | null; size: number } | null = null;
    server.use(
      http.post('/v1/admin/tuning/factions/luna/art/:slot', async ({ request, params }) => {
        seen = {
          slot: String(params.slot),
          type: request.headers.get('content-type'),
          size: (await request.arrayBuffer()).byteLength,
        };
        return HttpResponse.json({ slot: params.slot, url: '/v1/art/luna-logo-abc.png' });
      }),
    );
    renderWithProviders(<ArtEditor kind="factions" id="luna" />);
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'logo.png', { type: 'image/png' });
    expect(file.size).toBe(4);
    fireEvent.change(screen.getByTestId('art-file-logo'), { target: { files: [file] } });
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen).toEqual({ slot: 'logo', type: 'image/png', size: 4 });
  });

  it('a custom image can be reset to the default', async () => {
    let deleted: string | null = null;
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
              art: { banner: '/v1/art/luna-banner-1.png', logo: null, background: null },
            },
          ],
        }),
      ),
      http.delete('/v1/admin/tuning/factions/luna/art/:slot', ({ params }) => {
        deleted = String(params.slot);
        return HttpResponse.json({ slot: params.slot, url: null });
      }),
    );
    renderWithProviders(<ArtEditor kind="factions" id="luna" />);
    const banner = screen.getByTestId('art-slot-banner');
    await within(banner).findByText('Custom image');
    expect(within(banner).getByRole('img')).toHaveAttribute('src', '/v1/art/luna-banner-1.png');
    fireEvent.click(within(banner).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(deleted).toBe('banner'));
  });

  it('a faction badge shows its uploaded logo in front of its name', async () => {
    server.use(
      http.get('/v1/factions', () =>
        HttpResponse.json({
          factions: [
            {
              id: 'luna',
              displayName: { en: 'Luna Authority', 'pt-BR': 'Autoridade de Luna' },
              description: { en: '', 'pt-BR': '' },
              color: '#4a90d9',
              playable: true,
              art: { banner: null, logo: '/v1/art/luna-logo-9.png', background: null },
            },
          ],
        }),
      ),
    );
    const { container } = renderWithProviders(<FactionBadge factionId="luna" />);
    await waitFor(() => expect(container.querySelector('img.fac-logo')).not.toBeNull());
    expect(container.querySelector('img.fac-logo')).toHaveAttribute('src', '/v1/art/luna-logo-9.png');
  });

  it('places: wide/square/icon slots default to the built-in place files and upload to the locations endpoint', async () => {
    let seen: string | null = null;
    server.use(
      http.get('/v1/places/art', () =>
        HttpResponse.json({ places: { ceres: { wide: null, square: '/v1/art/ceres-square-1.png', icon: null } } }),
      ),
      http.post('/v1/admin/tuning/locations/ceres/art/:slot', ({ params }) => {
        seen = String(params.slot);
        return HttpResponse.json({ slot: params.slot, url: '/v1/art/ceres-icon-2.png' });
      }),
    );
    renderWithProviders(<ArtEditor kind="locations" id="ceres" />);
    const wide = screen.getByTestId('art-slot-wide');
    expect(within(wide).getByRole('img')).toHaveAttribute('src', '/places/ceres.wide.svg');
    const square = screen.getByTestId('art-slot-square');
    await within(square).findByText('Custom image');
    expect(within(square).getByRole('img')).toHaveAttribute('src', '/v1/art/ceres-square-1.png');
    const file = new File([new Uint8Array([1, 2])], 'i.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('art-file-icon'), { target: { files: [file] } });
    await waitFor(() => expect(seen).toBe('icon'));
  });

  it('a faction badge shows the admin\'s name and colour, not the language file\'s', async () => {
    server.use(
      http.get('/v1/factions', () =>
        HttpResponse.json({
          factions: [
            {
              id: 'luna',
              displayName: { en: 'Moon Combine', 'pt-BR': 'Consórcio Lunar' },
              description: { en: '', 'pt-BR': '' },
              color: '#12ab34',
              playable: true,
              art: null,
            },
          ],
        }),
      ),
    );
    renderWithProviders(<FactionBadge factionId="luna" />);
    const badge = await screen.findByText('Moon Combine');
    expect(badge).toHaveStyle({ color: '#12ab34' });
    expect(screen.queryByText('Luna Authority')).toBeNull();
  });
});
