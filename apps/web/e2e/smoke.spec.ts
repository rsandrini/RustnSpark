import { expect, test } from '@playwright/test';
import { FACTIONS, LEAKED_KEY, assertClean, registerAndLaunch } from './support';

/**
 * One player's whole loop against the real stack, for each playable faction, in both a desktop
 * and a phone viewport: register → launch → hangar → map → board → accept → dispatch → wait for
 * the worker → read the report (three views) → port. Along the way every screen is checked for
 * horizontal overflow, raw part codes and untranslated i18n keys — the failure modes the
 * MSW-backed tests cannot see.
 */

for (const faction of FACTIONS) {
  test(`${faction}: register, fly a mission, read the report, visit the port`, async ({ page }) => {
    await registerAndLaunch(page, faction);

    // --- hangar: the starter ship, named parts ---------------------------------------------
    await page.goto('/hangar');
    await expect(page.getByRole('heading', { name: 'Hangar' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Assembly yard' })).toBeVisible();
    await assertClean(page, 'hangar');

    // --- map ---------------------------------------------------------------------------------
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: 'Sector map' })).toBeVisible();
    await expect(page.locator('svg g[role="button"]')).toHaveCount(12);
    await assertClean(page, 'map');

    // --- board: a real starter ship must be able to take at least one mission ------------------
    await page.goto('/board');
    await expect(page.getByRole('heading', { name: 'Mission board' })).toBeVisible();
    // The board itself must work: offers are listed, each with its description and trip facts.
    await expect(page.locator('.mcard').first()).toBeVisible();
    // D43: on default settings a freshly onboarded player must always have a mission they can
    // accept — a private start-safe one when the shared board has nothing takeable.
    const accept = page.locator('button:has-text("Accept"):not([disabled])').first();
    await expect(
      accept,
      `${faction}: a freshly onboarded player has no acceptable mission on the home board`,
    ).toBeVisible();
    await assertClean(page, 'board');
    await accept.click();

    // --- transit: dispatch, then the worker resolves it --------------------------------------
    await expect(page).toHaveURL(/\/transit/);
    await page.getByRole('button', { name: 'Dispatch' }).click();
    await expect(page.getByTestId('in-transit')).toBeVisible();
    await assertClean(page, 'transit');
    await expect(page).toHaveURL(/\/report\//, { timeout: 90_000 });

    // --- report: all three views ---------------------------------------------------------------
    await expect(page.getByRole('heading', { name: 'Mission report' })).toBeVisible();
    // The debrief leads (verdict, mission, credits, fights), then the story.
    await expect(page.getByTestId('debrief')).toBeVisible();
    await expect(page.locator('article.event').first()).toBeVisible();
    await assertClean(page, 'report story');
    await page.getByRole('tab', { name: 'Summary' }).click();
    await assertClean(page, 'report summary');
    await page.getByRole('tab', { name: 'Log' }).click();
    await expect(page.locator('ol.log-lines li').first()).toBeVisible();
    await assertClean(page, 'report log');

    // --- port ----------------------------------------------------------------------------------
    await page.goto('/port');
    await expect(page.getByRole('heading', { name: 'Port', exact: true })).toBeVisible();
    await expect(page.getByTestId('wallet')).toBeVisible();
    await expect(page.locator('.pcard').first()).toBeVisible();
    await assertClean(page, 'port market');
    await page.getByRole('tab', { name: 'Refuel' }).click();
    await assertClean(page, 'port refuel');
    await page.getByRole('tab', { name: /^Repair/ }).click();
    await assertClean(page, 'port repair');
    await page.getByRole('tab', { name: 'Scavenging' }).click();
    await assertClean(page, 'port scavenging');

    // --- profile -------------------------------------------------------------------------------
    await page.goto('/profile');
    await assertClean(page, 'profile');
  });
}

test('the interface switches to Brazilian Portuguese and keeps it across screens', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel(/language/i).selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Criar conta' })).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(LEAKED_KEY);
});
