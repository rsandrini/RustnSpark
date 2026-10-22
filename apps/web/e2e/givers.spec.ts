import { expect, test, type Page } from '@playwright/test';
import { registerAndLaunch } from './support';

// The quest giver's face and voice on the real stack (plan §1, §7, §9): the board card names
// whoever offered a mission, the report closes with that giver and their line, the tutorial
// card greets the pilot through their faction's mentor, and an admin can edit a giver's lines.
// The seeded luna mentor is Ines Moura ("Dockmaster of Ceres").

async function loginAsAdmin(page: Page): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test('the Getting started card is a plain checklist (the mentor speaks in dialogue scenes)', async ({
  page,
}) => {
  await registerAndLaunch(page, 'luna');
  await page.goto('/ship');
  const card = page.locator('.tutorial-card');
  const pill = page.getByRole('button', { name: /Getting started/ });
  await expect(card.or(pill).first()).toBeVisible({ timeout: 20_000 });
  if (
    (await pill.count()) > 0 &&
    (await pill
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await pill.first().click();
  }
  await expect(page.locator('.tutorial-step').first()).toBeVisible();
  await expect(page.getByTestId('tutorial-mentor')).toHaveCount(0);
});

test('the board names the giver who offered a mission', async ({ page }) => {
  await registerAndLaunch(page, 'luna');
  await page.goto('/missions');
  // The row's badge line carries the face of whichever seeded luna giver offered the job.
  const giver = page.locator('.mrow-badges .giver-badge').first();
  await expect(giver).toBeVisible({ timeout: 15_000 });
  await expect(giver).toContainText(/Ines Moura|Anselm Rao|Ottilie Brandt/);
});

test('an admin can open a giver and see the bilingual line pools', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/tuning/entities/quest-givers');
  await expect(page.locator('.admin-nav')).toBeVisible();

  // The list shows the seeded givers; open the luna mentor.
  const row = page.locator('tr', { hasText: 'Ines Moura' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator('a').first().click();
  await expect(page).toHaveURL(/\/admin\/tuning\/entities\/quest-givers\/[^/]+$/);

  // The form opens on the giver's identity and the live badge preview.
  await expect(page.getByTestId('giver-preview')).toContainText('Ines Moura');
  // The structured line-pool editor renders the bilingual pools for the seeded giver.
  await expect(page.getByText('Offer: delivery')).toBeVisible();
  await expect(page.getByText('Report: success')).toBeVisible();
});

test("an admin sees the mentor's dialogue scenes and can preview a node", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/tuning/entities/quest-givers');
  const row = page.locator('tr', { hasText: 'Ines Moura' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator('a').first().click();
  const editor = page.getByRole('group', { name: 'Dialogue scenes' });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(
    editor.getByRole('button', { name: /welcome · The faction is chosen/ }),
  ).toBeVisible();
  await editor.getByRole('button', { name: 'Preview' }).first().click();
  await expect(editor.getByTestId('dialogue')).toContainText('Welcome to Ceres');
});
