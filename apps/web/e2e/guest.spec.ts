import { expect, test } from '@playwright/test';
import { dialoguesOff } from './support';

/**
 * Play as a guest against the real stack: no email and no password, the browser keeps the pilot
 * (its key survives losing the session cookie), and saving the pilot turns it into a normal account.
 */
test('a guest plays, comes back with only the key, saves the pilot and signs in with the email', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Play as guest' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your faction' })).toBeVisible();
  await page.locator('label.faction-card', { hasText: /luna/i }).click();
  await page.getByRole('button', { name: 'Launch' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await dialoguesOff(page);

  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByText('Guest pilot')).toBeVisible();
  const name = ((await page.locator('.shell-menu-name').textContent()) ?? '').trim();
  expect(name).toMatch(/^guest-[a-z0-9]{6}$/);
  await page.keyboard.press('Escape');

  // the session cookie is gone (a month away, a browser clean-up): the stored key signs the guest back in
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.locator('.shell-menu-name')).toHaveText(name);

  // save the pilot with an email and password
  const email = `guest${Date.now().toString(36)}@e2e.test`;
  await page.getByRole('button', { name: 'Save your pilot' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Password').fill('secret1');
  await dialog.getByRole('button', { name: 'Save pilot' }).click();
  await expect(dialog).toBeHidden();

  // it is an ordinary account now: sign out (no warning) and back in with the email
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByText('Guest pilot')).toBeHidden();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Play as guest' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('secret1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.locator('.shell-menu-name')).toHaveText(name);
});
