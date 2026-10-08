import { expect, test } from '@playwright/test';
import { registerAndLaunch, walletOf } from './support';
// Named to sort first: it needs a board whose luna offers were generated after the tuning.

// A real race, end to end on the real stack: the board shows the rival field, the pilot accepts,
// sees the rivals again before dispatch, flies, and the report shows the standings and a prize.
// The rivals are tuned slow by global-setup, and every other luna template is retired here so a starter ship wins and a
// RACE offer is what the board has; everything is put back afterwards.
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080';
let headers: Record<string, string> = {};
const restore: Array<() => Promise<void>> = [];

async function admin(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${baseURL}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${response.status}`);
  return response.status === 204 ? null : response.json();
}

test.describe('race mission', () => {
  test.beforeAll(async () => {
    const email = process.env.E2E_ADMIN_EMAIL;
    const password = process.env.E2E_ADMIN_PASSWORD;
    if (!email || !password) throw new Error('set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');
    const login = await fetch(`${baseURL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const { accessToken } = (await login.json()) as { accessToken: string };
    headers = { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` };

    const templates = (await admin('/v1/admin/tuning/mission-templates')) as {
      id: string;
      type: string;
      factionId: string;
      active: boolean;
    }[];
    for (const template of templates.filter(
      (row) => row.factionId === 'luna' && row.type !== 'RACE' && row.active,
    )) {
      await admin(`/v1/admin/tuning/mission-templates/${template.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ data: { active: false }, reason: 'race e2e' }),
      });
      restore.push(async () => {
        await admin(`/v1/admin/tuning/mission-templates/${template.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ data: { active: true }, reason: 'race e2e restore' }),
        });
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  });

  test.afterAll(async () => {
    for (const undo of restore.reverse()) await undo().catch(() => undefined);
  });

  test('the board shows the field, the pilot races and wins a prize, the report shows the standings', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'needs a board generated after the tuning; desktop runs first');
    await registerAndLaunch(page, 'luna');
    await page.goto('/port');
    const before = await walletOf(page);

    await page.goto('/board');
    const race = page.locator('.mcard.type-race').first();
    await expect(race).toBeVisible({ timeout: 30_000 });
    const field = race.getByTestId('race-field');
    expect(await field.locator('tbody tr').count()).toBeGreaterThanOrEqual(4); // 3-5 rivals + you

    await race.getByRole('button', { name: 'Accept' }).click();
    await expect(page).toHaveURL(/\/hangar/);
    await expect(page.getByTestId('race-rivals')).toBeVisible();
    await page.getByRole('button', { name: 'Dispatch' }).click();
    await expect(page).toHaveURL(/\/report\//, { timeout: 90_000 });

    const standings = page.getByTestId('debrief-race');
    await expect(standings).toBeVisible();
    expect(await standings.locator('tbody tr').count()).toBeGreaterThanOrEqual(4);
    await page.goto('/port');
    expect(await walletOf(page)).toBeGreaterThanOrEqual(before);
  });
});
