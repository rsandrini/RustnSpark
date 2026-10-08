import { expect, type Page } from '@playwright/test';

export const FACTIONS = ['luna', 'sun', 'explorers'] as const;

// A raw catalog code (engine_chem_small) or an i18n key that leaked into the UI (port.title).
const RAW_CODE = /\b[a-z]{3,}_[a-z_]{2,}\b/;
export const LEAKED_KEY =
  /\b(?:port|board|hangar|report|transit|error|nav|profile|inventory|rescue|ui)\.[A-Za-z_.]{2,}/;

export async function assertClean(page: Page, screen: string): Promise<void> {
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

export async function registerAndLaunch(
  page: Page,
  faction: (typeof FACTIONS)[number],
): Promise<void> {
  const id = `${faction}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const heading = page.getByRole('heading', { name: 'Choose your faction' });

  // Registration is throttled per IP (REGISTER_POLICY, 10/min), and this suite registers
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

  // The starter kit arrives loose (D44): assemble it the way a new pilot does, with Auto layout.
  await expect(page).toHaveURL(/\/hangar/);
  const assembled = page.waitForResponse((response) => response.url().includes('/auto-assemble'));
  await page.getByRole('button', { name: 'Auto layout' }).click();
  expect((await assembled).ok()).toBe(true);
}

/** Credits shown in the port header, as a number. */
export async function walletOf(page: Page): Promise<number> {
  const text = await page.getByTestId('topbar-wallet').innerText();
  return Number(text.replace(/[^\d-]/g, ''));
}

/** Accept the first acceptable mission on the home board, dispatch, and wait for the report. */
export async function flyOneMission(page: Page): Promise<void> {
  await page.goto('/board');
  await page.locator('button:has-text("Accept"):not([disabled])').first().click();
  await expect(page).toHaveURL(/\/hangar/);
  await page.getByRole('button', { name: 'Dispatch' }).click();
  // The transit screen sends the pilot to the report when the flight ends.
  await expect(page).toHaveURL(/\/report\//, { timeout: 90_000 });
}
