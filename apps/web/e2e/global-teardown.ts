import type { FullConfig } from '@playwright/test';

/**
 * Undoes what global-setup tuned. The smoke run speeds missions up (`missions.time_scale`), and on a
 * developer's own dev stack that change would otherwise stay in the database and silently make every
 * later trip take seconds. The reset goes through the same Admin endpoint, so it is a revision too.
 */
export default async function globalTeardown(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use.baseURL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) return;

  const login = await fetch(`${baseURL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) return;
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };

  const revisions = await fetch(`${baseURL}/v1/admin/tuning/revisions?limit=1`, { headers });
  const latest = revisions.ok ? ((await revisions.json()) as Array<{ id: string }>)[0] : undefined;
  await fetch(`${baseURL}/v1/admin/tuning/config/missions.time_scale/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      expectedRevision: Number(latest?.id ?? 0),
      reason: 'browser smoke teardown',
    }),
  });
}
