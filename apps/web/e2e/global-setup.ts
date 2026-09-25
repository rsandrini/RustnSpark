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
  // (`time_scale` 1). Only that is changed. The board is deliberately left at its default (ONE
  // public offer per port): a new player's first mission must come from the private start-safe
  // mission (D43), and this suite is what proves it on the real stack.
  const tuning: Array<[string, number]> = [['missions.time_scale', 0.001]];
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
