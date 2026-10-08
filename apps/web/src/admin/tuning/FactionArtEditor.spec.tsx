import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { renderWithProviders } from '../../test/utils';
import { server } from '../../test/msw/server';
import { FactionBadge } from '../../ui/FactionBadge';
import { FactionArtEditor } from './FactionArtEditor';

describe('FactionArtEditor', () => {
  it('shows the built-in banner as the default and nothing for logo/background until uploaded', () => {
    renderWithProviders(<FactionArtEditor factionId="luna" />);
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
    renderWithProviders(<FactionArtEditor factionId="luna" />);
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'logo.png', { type: 'image/png' });
    expect(file.size).toBe(4);
    fireEvent.change(screen.getByTestId('art-file-logo'), { target: { files: [file] } });
    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen).toEqual({ slot: 'logo', type: 'image/png', size: 4 });
  });

  it('a custom image can be reset to the default', async () => {
    let deleted: string | null = null;
    server.use(
      http.get('/v1/factions/art', () =>
        HttpResponse.json({
          factions: { luna: { banner: '/v1/art/luna-banner-1.png', logo: null, background: null } },
        }),
      ),
      http.delete('/v1/admin/tuning/factions/luna/art/:slot', ({ params }) => {
        deleted = String(params.slot);
        return HttpResponse.json({ slot: params.slot, url: null });
      }),
    );
    renderWithProviders(<FactionArtEditor factionId="luna" />);
    const banner = screen.getByTestId('art-slot-banner');
    await within(banner).findByText('Custom image');
    expect(within(banner).getByRole('img')).toHaveAttribute('src', '/v1/art/luna-banner-1.png');
    fireEvent.click(within(banner).getByRole('button', { name: 'Reset to default' }));
    await waitFor(() => expect(deleted).toBe('banner'));
  });

  it('a faction badge shows its uploaded logo in front of its name', async () => {
    server.use(
      http.get('/v1/factions/art', () =>
        HttpResponse.json({
          factions: { luna: { banner: null, logo: '/v1/art/luna-logo-9.png', background: null } },
        }),
      ),
    );
    const { container } = renderWithProviders(<FactionBadge factionId="luna" />);
    await waitFor(() => expect(container.querySelector('img.fac-logo')).not.toBeNull());
    expect(container.querySelector('img.fac-logo')).toHaveAttribute('src', '/v1/art/luna-logo-9.png');
  });
});
