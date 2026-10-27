import { expect, test } from '@playwright/test';
import { assertClean, flyOneMission, registerAndLaunch } from './support';

// The pilot's stats on the real stack: a fresh pilot has an empty card, and one flight shows up in the
// public card (missions, distance) without any of the private numbers.
test.use({ reducedMotion: 'reduce' });

async function ownName(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const refreshed = await fetch('/v1/auth/refresh', { method: 'POST', credentials: 'include' });
    const { accessToken } = (await refreshed.json()) as { accessToken: string };
    const me = await fetch('/v1/players/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return ((await me.json()) as { name: string }).name;
  });
}

test('a flight shows in the public pilot card and in the own stats, the card shows nothing private', async ({
  page,
}) => {
  await registerAndLaunch(page, 'luna');
  const name = await ownName(page);

  // before any flight: an empty card
  await page.goto(`/pilots/${encodeURIComponent(name)}`);
  await expect(page.getByText('No flights yet')).toBeVisible();
  await assertClean(page, 'pilot card (empty)');

  await flyOneMission(page);

  await page.goto(`/pilots/${encodeURIComponent(name)}`);
  const card = page.locator('main');
  await expect(card).toContainText(name);
  await expect(card).not.toContainText('No flights yet');
  await expect(card).toContainText('Missions');
  await expect(card).toContainText('Distance');
  await expect(card).not.toContainText(/Earned|Spent|Net|Biggest payout|Damage/);
  await assertClean(page, 'pilot card');

  // the own stats carry the private numbers
  await page.goto('/profile');
  await expect(page.getByRole('tab', { name: 'Money' })).toBeVisible();
  await page.getByRole('tab', { name: 'Money' }).click();
  await expect(page.getByText('Earned')).toBeVisible();
  await assertClean(page, 'own stats');
});
