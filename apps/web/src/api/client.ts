type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

let accessToken: string | null = null;
let onUnauthorized: () => void = () => {};
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setOnUnauthorized(fn: () => void): void {
  onUnauthorized = fn;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
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

async function rawRequest<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  allowRetry = true,
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });

  if (res.status === 401 && allowRetry) {
    const newToken = await refresh();
    if (!newToken) {
      onUnauthorized();
      throw new ApiError(401, 'Unauthorized');
    }
    return rawRequest(method, path, body, false);
  }

  if (!res.ok) {
    throw new ApiError(res.status, await parseError(res));
  }

  return res.json() as Promise<T>;
}

export const client = {
  get: <T>(path: string) => rawRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => rawRequest<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => rawRequest<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => rawRequest<T>('PUT', path, body),
  delete: <T>(path: string, body?: unknown) => rawRequest<T>('DELETE', path, body),
};
