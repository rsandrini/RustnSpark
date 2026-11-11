import { expect, test, type Page } from '@playwright/test';
import { accept, bar, dispatch, dragPart, next, onStep, read, register } from './opening-support';

/**
 * The race of the new-pilot opening, on the real screens: nothing but the race below the job card, a clock that never
 * runs backwards, and the friend's radio lines that stop the race while they are on the screen (a slow reader finds
 * one line at a time, never a pile).
 */

/** The seconds left of the flight, from the "In flight 00:49" line under the ship. */
async function flightLeft(page: Page): Promise<number | null> {
  const text = await page.evaluate(() => document.body.innerText).catch(() => '');
  const match = /In flight\s*(\d+):(\d+)/.exec(text);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

async function startRace(page: Page): Promise<void> {
  await register(page);
  await onStep(page, 'gift');
  await read(page);
  await next(page);
  await onStep(page, 'fit-engine');
  await read(page);
  await dragPart(page, /engine/i, -4, 0);
  await onStep(page, 'race-board');
  await read(page);
  await accept(page);
  await read(page);
  await onStep(page, 'race');
  await read(page);
}

test('the race screen is only the race: a lean job card, no yard, no ship sheet, no error line under it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await startRace(page);
  // before and after Dispatch the job is all there is
  await expect(page.locator('.hangar-scene')).toBeHidden();
  await expect(page.getByText('SHIP SHEET', { exact: false })).toBeHidden();
  // the job card keeps the job (what, where, pay, distance, time, fuel) and drops the rest
  for (const extra of ['The field', 'You need', 'FREE PILOTS', 'Engines:', 'Entry: speed']) {
    await expect(page.getByText(extra, { exact: false })).toHaveCount(0);
  }
  await expect(page.getByRole('heading', { name: 'Race to Dockside' })).toBeVisible();
  await dispatch(page);
  await expect.poll(() => flightLeft(page)).not.toBeNull();
  for (const extra of ['The field', 'You need', 'FREE PILOTS', 'INTRANSIT', 'Engines:']) {
    await expect(page.getByText(extra, { exact: false })).toHaveCount(0);
  }
  await expect(page.locator('.hangar-scene')).toBeHidden();
  await expect(page.getByText('The ship is on a mission.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save layout' })).toHaveCount(0);
});

test('the race clock never runs backwards, and a leg line stops it until it is read', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await startRace(page);
  await dispatch(page);

  let last = Number.POSITIVE_INFINITY;
  let stops = 0;
  let samples = 0;
  for (let guard = 0; guard < 400; guard += 1) {
    if ((await bar(page).getAttribute('data-step')) !== 'race') break;
    const dialogue = page.getByTestId('dialogue');
    if (await dialogue.isVisible().catch(() => false)) {
      // a line is on the screen: the flight stands still, however long it takes to read
      stops += 1;
      await page.waitForTimeout(600);
      const held = await flightLeft(page);
      await page.waitForTimeout(3000);
      const still = await flightLeft(page);
      expect(still).toBe(held);
      // there is one line at a time: the last button of a line says Continue, never Close
      await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(0);
      // reading it all lets the race go on
      await read(page);
      continue;
    }
    const left = await flightLeft(page);
    if (left !== null) {
      samples += 1;
      // time left only goes down (one second of slack for the display rounding)
      expect(left).toBeLessThanOrEqual(last + 1);
      last = Math.min(last, left);
    }
    await page.waitForTimeout(400);
  }
  // the friend spoke at the end of the legs, and the race still ended on the report
  expect(stops).toBeGreaterThan(0);
  // the clock was really watched (a test that reads nothing proves nothing)
  expect(samples).toBeGreaterThan(20);
  await onStep(page, 'race-report');
});
