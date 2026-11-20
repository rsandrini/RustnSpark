import { expect, test } from '@playwright/test';
import { assertClean } from './support';

/**
 * Landing page E2E coverage (phase 4, task 6): the signed-out marketing screen loads its
 * hero, facts, auth panel, and showcase sections at both widths, in both languages, without
 * leaking raw codes or i18n keys and without horizontal overflow.
 */

const LANDING_SECTIONS = [
  { id: 'build', title: /Your ship is a puzzle of parts/i },
  { id: 'race', title: /Pick a job\. Beat the field\./i },
];

for (const path of ['/login', '/register']) {
  test(`${path} shows the hero, auth panel, and showcase sections`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole('heading', { name: /Rust and Spark/i, level: 1 })).toBeVisible();
    await expect(page.getByText(/Assemble a ship from parts/i)).toBeVisible();
    await expect(page.getByTestId('landing-facts')).toBeVisible();

    await expect(
      page.getByRole('tab', { name: path === '/login' ? /Sign in/i : /Create account/i }),
    ).toHaveAttribute('aria-selected', 'true');

    if (path === '/login') {
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    } else {
      await expect(page.getByLabel('Name')).toBeVisible();
      await expect(page.getByLabel('Email')).toBeVisible();
      await expect(page.getByLabel('Password')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    }

    for (const section of LANDING_SECTIONS) {
      await expect(page.getByRole('heading', { name: section.title })).toBeVisible();
      await expect(
        page.locator(
          `section:has(> div .landing-shot)[aria-labelledby="landing-${section.id}-title"]`,
        ),
      ).toBeVisible();
    }

    await assertClean(page, path);
  });
}

test('the auth tabs switch between sign-in and create-account', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Name')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('tab', { name: 'Create account' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByLabel('Name')).toBeVisible();

  await page.getByRole('tab', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Password')).toBeVisible();
});

test('the landing page renders in Brazilian Portuguese', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/language/i).selectOption('pt-BR');
  await expect(page.getByRole('heading', { name: /Rust and Spark/i, level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Sua nave é um quebra-cabeça de peças/i }),
  ).toBeVisible();
  await assertClean(page, '/login pt-BR');
});

test('the landing page has no horizontal overflow on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await assertClean(page, '/register phone');
});
