type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  // Repeating a mutation with the same key must replay the first answer server-side
  // (S7.3): a retried accept/dispatch never double-books. crypto.randomUUID keeps the
  // key unique without Math.random (web rule bans it).
  idempotencyKey?: string;
}

let accessToken: string | null = null;
let onUnauthorized: () => void = () => {};
let refreshPromise: Promise<string | null> | null = null;
// Server clock offset: every response's Date header tells us how far the API's clock
// runs from ours; countdowns (hold timers, transit ETA) must run on server time, not
// the browser's (design ux §6).
let serverOffsetMs = 0;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setOnUnauthorized(fn: () => void): void {
  onUnauthorized = fn;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// The new-pilot opening runs its own world on this same clock, and it can hold it still while a guide speaks (a race
// waits for the pilot to read): `frozenAt` is the moment it stands at, `heldMs` the time already spent standing.
let frozenAt: number | null = null;
let heldMs = 0;

export function serverNow(): number {
  return frozenAt ?? Date.now() + serverOffsetMs - heldMs;
}

/** Holds the clock still at `at` (default: now) until `resumeClock`. */
export function holdClock(at: number = serverNow()): void {
  if (frozenAt === null) frozenAt = at;
}

/** Lets the held clock run on from where it stood. */
export function resumeClock(): void {
  if (frozenAt === null) return;
  heldMs += Date.now() + serverOffsetMs - heldMs - frozenAt;
  frozenAt = null;
}

/** Back to the plain server clock (the opening is over). */
export function resetClockHold(): void {
  frozenAt = null;
  heldMs = 0;
}

/** A precise server timestamp (a response body's own `serverTime`) sets the same clock every countdown reads. */
export function syncServerTime(iso: string): void {
  // the opening's world keeps its own time: a server timestamp must not move it
  if (interceptor !== null) return;
  const parsed = Date.parse(iso);
  if (!Number.isNaN(parsed)) serverOffsetMs = parsed - Date.now();
}

export function serverOffset(): number {
  return serverOffsetMs;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The API answers errors as `{ statusCode, message }` where `message` is a string, an
// array (validation), or an object carrying the machine code (e.g. `{ error: 'HOLD_LIMIT' }`).
// Everything the UI needs to branch on lands on `code`; the human text stays on `message`.
function parseErrorBody(status: number, body: unknown): { message: string; code?: string } {
  if (typeof body === 'object' && body !== null) {
    const record = body as Record<string, unknown>;
    const raw = record.message ?? record.error;
    if (typeof raw === 'string') {
      const code = typeof record.error === 'string' ? record.error : undefined;
      return { message: raw, code };
    }
    if (Array.isArray(raw)) {
      const parts = raw.filter((part): part is string => typeof part === 'string');
      return { message: parts.join('; ') || `HTTP ${status}` };
    }
    if (typeof raw === 'object' && raw !== null) {
      const nested = raw as Record<string, unknown>;
      if (typeof nested.error === 'string') {
        return { message: nested.error, code: nested.error };
      }
      const parts = Object.values(nested).filter(
        (part): part is string => typeof part === 'string',
      );
      return { message: parts.join('; ') || `HTTP ${status}` };
    }
  }
  return { message: `HTTP ${status}` };
}

export async function refresh(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const res = await fetch('/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) {
        return null;
      }
      const data = (await res.json()) as { accessToken: string };
      accessToken = data.accessToken;
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Blob.arrayBuffer() is everywhere a real browser is; the FileReader path covers older engines
// (and jsdom) so an image upload never depends on it.
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('could not read the file'));
    reader.readAsArrayBuffer(blob);
  });
}

/** What an interceptor is asked: the call the app is about to make. */
export interface InterceptedRequest {
  method: string;
  path: string;
  body: unknown;
}

/**
 * An interceptor answers a call itself (`handled`) or leaves it to the network. The new-pilot opening installs
 * one so the game's real screens run on a small fake server in the browser; it throws an `ApiError` to fail a call.
 */
export type ApiInterceptor = (
  request: InterceptedRequest,
) => Promise<{ handled: true; value: unknown } | { handled: false }>;

let interceptor: ApiInterceptor | null = null;

/** Installs the interceptor, or removes it with `null` (every call then goes to the network again). */
export function setApiInterceptor(next: ApiInterceptor | null): void {
  interceptor = next;
}

async function rawRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
  allowRetry = true,
): Promise<T> {
  if (interceptor !== null) {
    const answer = await interceptor({ method, path, body });
    if (answer.handled) return answer.value as T;
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  // A Blob (an image upload) goes out as itself with its own type; everything else is JSON.
  const binary = typeof Blob !== 'undefined' && body instanceof Blob;
  const payload: BodyInit | undefined =
    body === undefined ? undefined : binary ? await bytesOf(body) : JSON.stringify(body);
  if (binary) {
    headers['Content-Type'] = body.type;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (options.idempotencyKey !== undefined) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
  });

  const dateHeader = res.headers.get('date');
  if (dateHeader !== null) {
    const parsed = Date.parse(dateHeader);
    // while the opening runs, the clock is the opening's own: a real call's Date header must not shift it
    if (!Number.isNaN(parsed) && interceptor === null) {
      serverOffsetMs = parsed - Date.now();
    }
  }

  if (res.status === 401 && allowRetry) {
    const newToken = await refresh();
    if (!newToken) {
      onUnauthorized();
      throw new ApiError(401, 'Unauthorized', 'UNAUTHORIZED');
    }
    return rawRequest(method, path, body, options, false);
  }

  if (!res.ok) {
    const parsedBody: unknown = await res.json().catch(() => null);
    const parsed = parseErrorBody(res.status, parsedBody);
    // The throttler answers a plain 429 with no machine code: give it one so the UI can
    // translate it like every other failure.
    const code = res.status === 429 ? 'RATE_LIMITED' : parsed.code;
    throw new ApiError(res.status, parsed.message, code, parsedBody);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const client = {
  get: <T>(path: string) => rawRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    rawRequest<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    rawRequest<T>('PATCH', path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    rawRequest<T>('PUT', path, body, options),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    rawRequest<T>('DELETE', path, body, options),
};
