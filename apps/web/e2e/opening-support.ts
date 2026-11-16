import { expect, type Locator, type Page } from '@playwright/test';

/** Helpers for playing the new-pilot opening through its real screens (shared by the opening's specs). */

export async function register(page: Page): Promise<void> {
  const id = `open${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto('/register');
    await page.getByLabel('Name').fill(id.slice(0, 20));
    await page.getByLabel('Email').fill(`${id}@e2e.test`);
    await page.getByLabel('Password').fill('e2e-player-password-1');
    await page.getByRole('button', { name: 'Create account' }).click();
    const ok = await page
      .getByTestId('opening-bar')
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
    await page.waitForTimeout(22_000); // registration is throttled per IP
  }
  throw new Error('could not register');
}

export const bar = (page: Page) => page.getByTestId('opening-bar');
export const onStep = (page: Page, id: string, timeout = 15_000) =>
  expect(bar(page)).toHaveAttribute('data-step', id, { timeout });

/** Reads a guide's lines to the end: the first press finishes the typing, the next goes on. */
export async function read(page: Page): Promise<void> {
  const box = page.getByTestId('dialogue');
  // the lines of a step open a moment after the step starts (a line can wait a few seconds on purpose)
  await box.waitFor({ timeout: 6000 }).catch(() => undefined);
  for (let guard = 0; guard < 40 && (await box.isVisible().catch(() => false)); guard += 1) {
    await box
      .locator('.dialogue-actions .btn.primary')
      .first()
      .click({ timeout: 2000 })
      .catch(() => undefined);
    await page.waitForTimeout(150);
  }
}

/** A finished mission opens its short result card first; the guide's lines wait until it is closed. */
export async function closeResult(page: Page): Promise<void> {
  const close = page.getByTestId('mission-result-close');
  await close.waitFor({ timeout: 8000 }).catch(() => undefined);
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** The step's button that moves the story on (a report to read, the gift, the choice of job). */
export async function next(page: Page): Promise<void> {
  await page.getByTestId('opening-continue').click();
  // the lines said when a step ends
  await read(page);
}

/** Puts a loose part on the yard (tap the part, then tap the cell) and saves the layout. */
export async function dragPart(page: Page, name: RegExp, gx: number, gy: number): Promise<void> {
  const row: Locator = page.locator('.hangar-side .part-btn', { hasText: name }).first();
  // on a phone the loose parts are in a sheet behind the Parts button
  const sheet = page.getByRole('button', { name: /^Parts \(/ });
  if (await sheet.isVisible().catch(() => false)) await sheet.click();
  await expect(row).toBeVisible();
  await row.click();
  const cell = page
    .locator(`.hangar-scene svg rect.yard-cell[data-gx="${gx}"][data-gy="${gy}"]`)
    .first();
  const box = await cell.boundingBox();
  if (box === null) throw new Error('no such cell');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // there is no Save button in the opening: the layout saves itself a moment after the drop
  await expect(page.getByRole('button', { name: 'Save layout' })).toHaveCount(0);
  // the lines said when the step ends
  await read(page);
}

export async function dispatch(page: Page): Promise<void> {
  await page.locator('[data-tour="dispatch_button"]').click();
}

export async function accept(page: Page, index = 0): Promise<void> {
  await page.locator('[data-tour="accept_button"]:not([disabled])').nth(index).click();
}
