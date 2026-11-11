import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, client, setApiInterceptor } from './client';

describe('the API interceptor (the opening runs on a fake server in the browser)', () => {
  afterEach(() => {
    setApiInterceptor(null);
    vi.restoreAllMocks();
  });

  it('answers a request it handles without touching the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    setApiInterceptor(({ method, path }) =>
      Promise.resolve(
        method === 'GET' && path === '/v1/thing'
          ? { handled: true as const, value: { ok: 1 } }
          : { handled: false as const },
      ),
    );
    await expect(client.get('/v1/thing')).resolves.toEqual({ ok: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('hands the method, the path and the body to the interceptor', async () => {
    const seen: unknown[] = [];
    setApiInterceptor((request) => {
      seen.push(request);
      return Promise.resolve({ handled: true, value: null });
    });
    await client.post('/v1/ships/s1/assemble', { layout: [] });
    expect(seen).toEqual([{ method: 'POST', path: '/v1/ships/s1/assemble', body: { layout: [] } }]);
  });

  it('lets a request it does not handle go to the network', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ real: true }), { status: 200 }));
    setApiInterceptor(() => Promise.resolve({ handled: false }));
    await expect(client.get('/v1/other')).resolves.toEqual({ real: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('turns an error the interceptor throws into the screen’s usual ApiError', async () => {
    setApiInterceptor(() => Promise.reject(new ApiError(409, 'no', 'INSUFFICIENT_FUNDS')));
    await expect(client.post('/v1/market/buy', {})).rejects.toMatchObject({
      status: 409,
      code: 'INSUFFICIENT_FUNDS',
    });
  });

  it('goes back to the network once the interceptor is removed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ real: true }), { status: 200 }));
    setApiInterceptor(() => Promise.resolve({ handled: true, value: { fake: true } }));
    await expect(client.get('/v1/x')).resolves.toEqual({ fake: true });
    setApiInterceptor(null);
    await expect(client.get('/v1/x')).resolves.toEqual({ real: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
