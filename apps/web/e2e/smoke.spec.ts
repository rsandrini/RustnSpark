import { expect, test } from '@playwright/test';
import {
  FACTIONS,
  LEAKED_KEY,
  assertClean,
  registerAndLaunch,
  openPortTab,
  acceptableMission,
} from './support';

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
    await page.goto('/ship');
    await expect(page.getByRole('heading', { name: 'My Ship' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Assembly yard' })).toBeVisible();
    await assertClean(page, 'hangar');

    // --- map ---------------------------------------------------------------------------------
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: 'Sector map' })).toBeVisible();
    // the map opens centred and zoomed on the port the ship is stopped at: Fit map shows the whole sector
    await expect(page.getByRole('button', { name: 'Fit map' })).toBeEnabled();
    await page.getByRole('button', { name: 'Fit map' }).click();
    await expect(page.getByRole('button', { name: 'Fit map' })).toBeDisabled();
    await expect(page.locator('svg g.node-hit')).toHaveCount(18);
    // zoom and pan: the buttons work, and Fit map returns to the whole sector
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByRole('button', { name: 'Fit map' })).toBeEnabled();
    await page.getByRole('button', { name: 'Fit map' }).click();
    await expect(page.getByRole('button', { name: 'Fit map' })).toBeDisabled();
    await assertClean(page, 'map');

    // --- board: a real starter ship must be able to take at least one mission ------------------
    await page.goto('/missions');
    await expect(page.getByRole('group', { name: 'Mission board' })).toBeVisible();
    // The board itself must work: offers are listed, each row with its requirements and trip facts.
    await expect(page.locator('.mrow').first()).toBeVisible();
    // D43: on default settings a freshly onboarded player must always have a mission they can
    // accept — a private start-safe one when the shared board has nothing takeable.
    const accept = await acceptableMission(page);
    await expect(
      accept,
      `${faction}: a freshly onboarded player has no acceptable mission on the home board`,
    ).toBeVisible();
    await assertClean(page, 'board');
    await accept.click();

    // --- transit: dispatch, then the worker resolves it --------------------------------------
    await expect(page).toHaveURL(/\/ship/);
    await page.getByRole('button', { name: 'Dispatch' }).click();
    // The first flight is a hop to the test pad, only seconds long: the flight view may already be gone
    // by the time we look, so either the flight or the report is fine.
    const flying = page.getByTestId('in-transit');
    await expect(flying.or(page.getByRole('heading', { name: 'Mission report' }))).toBeVisible();
    if (await flying.isVisible()) await assertClean(page, 'transit');
    await expect(page).toHaveURL(/\/report\//, { timeout: 90_000 });

    // --- report: all three views ---------------------------------------------------------------
    await expect(page.getByRole('heading', { name: 'Mission report' })).toBeVisible();
    // The debrief leads (verdict, mission, credits, fights), then the story.
    await expect(page.getByTestId('debrief')).toBeVisible();
    // The overview opens first: the trip on the map and what it cost the ship.
    await expect(page.getByTestId('report-overview')).toBeVisible();
    await assertClean(page, 'report overview');
    await page.getByRole('tab', { name: 'The story' }).click();
    await expect(page.locator('article.event').first()).toBeVisible();
    await assertClean(page, 'report story');
    await page.getByRole('tab', { name: 'Log' }).click();
    await expect(page.locator('table.log-table tbody tr').first()).toBeVisible();
    await assertClean(page, 'report log');

    // --- port ----------------------------------------------------------------------------------
    await page.goto('/port');
    await expect(page.getByTestId('topbar-wallet')).toBeVisible();
    // A small repair-and-fuel stop (a first mission may end at one) has no market: its Port has no
    // Market tab, and the market checks only apply where there is one.
    if ((await page.getByRole('tab', { name: 'Market' }).count()) > 0) {
      await expect(page.locator('.pcard').first()).toBeVisible();
      await assertClean(page, 'port market');
    }
    await openPortTab(page, 'Refuel');
    await assertClean(page, 'port refuel');
    await openPortTab(page, 'Repair');
    await assertClean(page, 'port repair');
    // (the work tabs only exist where there is work to do: a test pad has none)
    const work = page.getByRole('tab', { name: /^Work/ });
    if ((await work.count()) > 0) {
      await work.click();
      if ((await page.getByRole('tab', { name: 'Scavenging' }).count()) > 0) {
        await openPortTab(page, 'Scavenging');
        await assertClean(page, 'port scavenging');
      }
    }

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
