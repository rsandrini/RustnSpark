import { expect, type Locator, type Page } from '@playwright/test';

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
    // On a phone, content wider than the screen makes the browser widen its layout viewport
    // instead of scrolling — so measure against the screen itself (the visual viewport).
    const screenWidth = Math.min(
      window.innerWidth,
      window.visualViewport?.width ?? window.innerWidth,
    );
    const extra = Math.max(
      document.documentElement.scrollWidth - screenWidth,
      window.innerWidth - screenWidth,
    );
    if (extra <= 1) return { extra, culprits: [] as string[] };
    // Name the elements that stick out, so a failure says what to fix, not just "916px".
    const culprits = Array.from(document.body.querySelectorAll('*'))
      .filter((el) => el.getBoundingClientRect().right > screenWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class'))}`);
    return { extra, culprits };
  });
  expect(
    overflow.extra,
    `${screen}: horizontal overflow ${overflow.extra}px — ${overflow.culprits.join(', ')}`,
  ).toBeLessThanOrEqual(1);
}

/**
 * Turns the mentor's dialogues off for the signed-in pilot, the way a pilot would from the account menu but through
 * the API (the refresh cookie of the page gives the token), then reloads so nothing is left on the screen. The scenes
 * open popups over the game; the specs that are about something else do not want them in the way. Specs about the
 * dialogue itself pass `{ dialogues: true }` to `registerAndLaunch`.
 */
export async function dialoguesOff(page: Page): Promise<void> {
  const refreshed = await page.request.post('/v1/auth/refresh');
  const { accessToken } = (await refreshed.json()) as { accessToken: string };
  const response = await page.request.post('/v1/players/me/dialogue/settings', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { enabled: false },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
}

export async function registerAndLaunch(
  page: Page,
  faction: (typeof FACTIONS)[number],
  options: { dialogues?: boolean } = {},
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

  if (options.dialogues !== true) await dialoguesOff(page);

  // The starter kit arrives loose (D44): assemble it the way a new pilot does, with Auto layout.
  await expect(page).toHaveURL(/\/ship/);
  const assembled = page.waitForResponse((response) => response.url().includes('/auto-assemble'));
  await page.getByRole('button', { name: 'Auto layout' }).click();
  expect((await assembled).ok()).toBe(true);
}

/** Credits shown in the port header, as a number. */
export async function walletOf(page: Page): Promise<number> {
  const text = await page.getByTestId('topbar-wallet').innerText();
  return Number(text.replace(/[^\d-]/g, ''));
}

/** The names of the small repair-and-fuel stops, which have no market. */
const SERVICE_STOP_NAMES = /Drydock|Slipway|Slag Heap|Fuel Depot|Ore Claim|Waystation/;

/**
 * The mission to take from the home board: the player's private starter mission when there is
 * one, else the first offer they can accept. The starter mission only exists when the shared
 * board has nothing takeable, so a random public offer is a normal first mission too.
 */
export async function acceptableMission(page: Page): Promise<Locator> {
  const accept = 'button:has-text("Accept"):not([disabled])';
  await expect(page.locator('.mrow').first()).toBeVisible();
  const starter = page.locator('.mrow', { hasText: 'Starter mission' }).locator(accept).first();
  if ((await starter.count()) > 0) return starter;
  // Prefer a public offer that does not end at a service stop (no market there), but take one that
  // does when it is the only offer: the Port checks after a flight cope with a stop.
  const tradeable = page
    .locator('.mrow', { hasNotText: SERVICE_STOP_NAMES })
    .locator(accept)
    .first();
  return (await tradeable.count()) > 0 ? tradeable : page.locator(accept).first();
}

/** Accept the first acceptable mission on the home board, dispatch, and wait for the report. */
export async function flyOneMission(page: Page): Promise<void> {
  await page.goto('/missions');
  await (await acceptableMission(page)).click();
  await expect(page).toHaveURL(/\/ship/);
  await page.getByRole('button', { name: 'Dispatch' }).click();
  // The transit screen sends the pilot to the report when the flight ends.
  await expect(page).toHaveURL(/\/report\//, { timeout: 90_000 });
}

/** A new ship starts with a low tank (the tutorial's first step is to fill it): fill it before a real trip. */
export async function fillTank(page: Page): Promise<void> {
  await page.goto('/port?tab=refuel');
  const buy = page.getByRole('button', { name: /^Buy \d+$/ });
  await expect(buy).toBeVisible();
  // the slider opens on what the wallet covers: ask for the whole tank when the button is there
  const whole = page.getByRole('button', { name: 'Fill tank' }).first();
  if ((await whole.count()) > 0 && (await whole.isEnabled())) await whole.click();
  await buy.click();
  await expect(page.getByText(/^Filled \d+ units/)).toBeVisible();
}

const PORT_TAB_GROUP: Record<string, string> = {
  Market: 'Buy',
  'Your goods': 'Buy',
  Repair: 'Service',
  Refuel: 'Service',
  Upgrade: 'Service',
  Scavenging: 'Work',
  Mining: 'Work',
};

/** The Port's seven tabs sit under three groups (Buy, Service, Work): open the group, then the tab. */
export async function openPortTab(page: Page, name: string): Promise<void> {
  const group = PORT_TAB_GROUP[name];
  if (group === undefined) throw new Error(`unknown Port tab ${name}`);
  const groupTab = page.getByRole('tab', { name: new RegExp(`^${group}`) });
  if ((await groupTab.getAttribute('aria-selected')) !== 'true') await groupTab.click();
  await page.getByRole('tab', { name: name === 'Repair' ? /^Repair/ : name }).click();
}
