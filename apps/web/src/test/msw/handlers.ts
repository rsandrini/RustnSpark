import { http, HttpResponse } from 'msw';

const accessToken = 'test-access-token';

export const handlers = [
  http.post('/v1/auth/login', () =>
    HttpResponse.json({ accessToken }, { status: 200 }),
  ),

  http.post('/v1/auth/register', () =>
    HttpResponse.json(
      {
        accessToken,
        player: {
          id: 'player-1',
          name: 'Test Pilot',
          credits: 0,
          role: 'PLAYER',
          locale: 'en',
        },
      },
      { status: 200 },
    ),
  ),

  http.post('/v1/auth/refresh', () =>
    HttpResponse.json({ accessToken }, { status: 200 }),
  ),

  http.post('/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),

  http.get('/v1/players/me', () =>
    HttpResponse.json(
      {
        id: 'player-1',
        name: 'Test Pilot',
        credits: 0,
        role: 'PLAYER',
        locale: 'en',
      },
      { status: 200 },
    ),
  ),

  http.post('/v1/players/me/locale', async ({ request }) => {
    const body = (await request.json()) as { locale: string };
    return HttpResponse.json({ locale: body.locale }, { status: 200 });
  }),
];
