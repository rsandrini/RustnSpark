import type { FullConfig } from '@playwright/test';

/**
 * Prepares the stack for a fast, realistic smoke run by tuning two config keys as the admin.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use.baseURL ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (an admin created with the CLI)');
  }

  const login = await fetch(`${baseURL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`admin login failed: ${login.status}`);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };

  // The seeded defaults are tuned for a live game, not a smoke test: missions take real minutes
  // (`time_scale` 1) and every port lists ONE offer (`board_min_per_location` 1), which for a
  // brand-new player is usually a mission their starter ship cannot take. Tune both through the
  // real tuning API (D33: the database wins, effective immediately).
  const tuning: Array<[string, number]> = [
    ['missions.time_scale', 0.001],
    ['missions.board_min_per_location', 20],
  ];
  for (const [key, value] of tuning) {
    const revisions = await fetch(`${baseURL}/v1/admin/tuning/revisions?limit=1`, { headers });
    const latest = revisions.ok
      ? ((await revisions.json()) as Array<{ id: string }>)[0]
      : undefined;
    const patch = await fetch(`${baseURL}/v1/admin/tuning/config/${key}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        value,
        expectedRevision: Number(latest?.id ?? 0),
        reason: 'browser smoke setup',
      }),
    });
    if (!patch.ok) throw new Error(`could not tune ${key}: ${patch.status}`);
  }
  // Config changes reach the API and the worker through Redis pub/sub (within ~2 s).
  await new Promise((resolve) => setTimeout(resolve, 3_000));
}
