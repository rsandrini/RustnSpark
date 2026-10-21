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

test('a luna pilot sees their mentor on the Getting started card', async ({ page }) => {
  await registerAndLaunch(page, 'luna');
  await page.goto('/ship');
  // The checklist is an open card on desktop and a small pill on a phone; either way the
  // mentor block appears inside it once the mentor query resolves.
  const mentor = page.getByTestId('tutorial-mentor');
  const pill = page.getByRole('button', { name: /Getting started/ });
  const card = page.locator('.tutorial-card');
  // Give the card a chance to render first (it may be collapsed as the pill).
  await expect(card.or(pill).first()).toBeVisible({ timeout: 20_000 });
  if ((await mentor.count()) === 0 && (await pill.count()) > 0) {
    // Opening the pill swaps the button for the card; wait for the button if it is there.
    if (
      await pill
        .first()
        .isVisible()
        .catch(() => false)
    )
      await pill.first().click();
  }
  await expect(mentor).toBeVisible({ timeout: 20_000 });
  // The seeded luna mentor greets the new pilot by name and title.
  await expect(mentor).toContainText('Ines Moura');
  await expect(mentor).toContainText('Dockmaster of Ceres');
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
