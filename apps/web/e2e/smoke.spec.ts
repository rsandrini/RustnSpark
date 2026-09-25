import { expect, test, type Page } from '@playwright/test';

/**
 * One player's whole loop against the real stack, for each playable faction, in both a desktop
 * and a phone viewport: register → launch → hangar → map → board → accept → dispatch → wait for
 * the worker → read the report (three views) → port. Along the way every screen is checked for
 * horizontal overflow, raw part codes and untranslated i18n keys — the failure modes the
 * MSW-backed tests cannot see.
 */

const FACTIONS = ['luna', 'sun', 'explorers'] as const;

// A raw catalog code (engine_chem_small) or an i18n key that leaked into the UI (port.title).
const RAW_CODE = /\b[a-z]{3,}_[a-z_]{2,}\b/;
const LEAKED_KEY =
  /\b(?:port|board|hangar|report|transit|error|nav|profile|inventory|rescue|ui)\.[A-Za-z_.]{2,}/;

async function assertClean(page: Page, screen: string): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text, `${screen}: raw catalog code visible`).not.toMatch(RAW_CODE);
  expect(text, `${screen}: untranslated i18n key visible`).not.toMatch(LEAKED_KEY);
  const overflow = await page.evaluate(() => {
    const extra = document.documentElement.scrollWidth - window.innerWidth;
    if (extra <= 1) return { extra, culprits: [] as string[] };
    // Name the elements that stick out, so a failure says what to fix, not just "916px".
    const culprits = Array.from(document.body.querySelectorAll('*'))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class'))}`);
    return { extra, culprits };
  });
  expect(
    overflow.extra,
    `${screen}: horizontal overflow ${overflow.extra}px — ${overflow.culprits.join(', ')}`,
  ).toBeLessThanOrEqual(1);
}

async function registerAndLaunch(page: Page, faction: (typeof FACTIONS)[number]): Promise<void> {
  const id = `${faction}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const heading = page.getByRole('heading', { name: 'Choose your faction' });

  // Registration is throttled to 3 per minute per IP (auth policy), and this suite registers
  // several players in a row from one IP: when the form answers with an error, wait out the
  // window and try again instead of failing on a rate limit that is not what is under test.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto('/register');
    await page.getByLabel('Name').fill(id.slice(0, 20));
    await page.getByLabel('Email').fill(`${id}@e2e.test`);
    await page.getByLabel('Password').fill('e2e-player-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    const outcome = await Promise.race([
      heading.waitFor({ timeout: 10_000 }).then(() => 'ok' as const),
      page
        .getByRole('alert')
        .waitFor({ timeout: 10_000 })
        .then(() => 'error' as const),
    ]).catch(() => 'error' as const);
    if (outcome === 'ok') break;
    await page.waitForTimeout(22_000);
  }

  await expect(heading).toBeVisible();
  await page.locator('label.faction-card', { hasText: new RegExp(faction, 'i') }).click();
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
}

for (const faction of FACTIONS) {
  test(`${faction}: register, fly a mission, read the report, visit the port`, async ({ page }) => {
    await registerAndLaunch(page, faction);

    // --- hangar: the starter ship, named parts ---------------------------------------------
    await page.goto('/hangar');
    await expect(page.getByRole('heading', { name: 'Hangar' })).toBeVisible();
    await expect(page.getByText('Assembly yard').or(page.getByRole('group'))).toBeVisible();
    await assertClean(page, 'hangar');

    // --- map ---------------------------------------------------------------------------------
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: 'Sector map' })).toBeVisible();
    await expect(page.locator('svg g[role="button"]')).toHaveCount(12);
    await assertClean(page, 'map');

    // --- board: a real starter ship must be able to take at least one mission ------------------
    await page.goto('/board');
    await expect(page.getByRole('heading', { name: 'Mission board' })).toBeVisible();
    // The board itself must work: offers are listed.
    await expect(page.locator('.item').first()).toBeVisible();
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
    await expect(page.getByTestId('last-mission')).toBeVisible({ timeout: 90_000 });

    // --- report: all three views ---------------------------------------------------------------
    await page.getByRole('link', { name: 'Read the report' }).click();
    await expect(page.getByRole('heading', { name: 'Mission report' })).toBeVisible();
    await expect(page.locator('.verdict')).toBeVisible();
    await assertClean(page, 'report summary');
    await page.getByRole('tab', { name: 'Narrative' }).click();
    await expect(page.locator('article.event').first()).toBeVisible();
    await assertClean(page, 'report narrative');
    await page.getByRole('tab', { name: 'Log' }).click();
    await expect(page.locator('ol.log-lines li').first()).toBeVisible();
    await assertClean(page, 'report log');

    // --- port ----------------------------------------------------------------------------------
    await page.goto('/port');
    await expect(page.getByRole('heading', { name: 'Port' })).toBeVisible();
    await expect(page.getByTestId('wallet')).toBeVisible();
    await expect(page.locator('.item').first()).toBeVisible();
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
