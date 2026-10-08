import { expect, test, type Page } from '@playwright/test';

// Admin layout audit on the REAL stack, at the desktop and phone viewports (playwright projects):
// every admin screen keeps the top menu, never scrolls sideways, and the entity edit/create pages
// are routed pages inside the shell (not a full-screen modal that hides the menu).
const ROUTES = [
  '',
  'analytics/economy',
  'analytics/world',
  'players',
  'system',
  'tuning/config',
  'tuning/entities/parts',
  'tuning/entities/ship-formats',
  'tuning/entities/materials',
  'tuning/entities/factions',
  'tuning/entities/locations',
  'tuning/entities/routes',
  'tuning/entities/environments',
  'tuning/entities/mission-templates',
  'tuning/entities/drop-tables',
  'tuning/revisions',
];
const EDITABLE = ['parts', 'ship-formats', 'factions', 'mission-templates'];

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

async function assertShellAndNoSidewaysScroll(page: Page, screen: string): Promise<void> {
  await expect(page.locator('.admin-nav'), `${screen}: admin top menu`).toBeVisible();
  const overflow = await page.evaluate(() => {
    const extra = document.documentElement.scrollWidth - window.innerWidth;
    if (extra <= 1) return { extra, culprits: [] as string[] };
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

// One login for the whole audit (login is throttled per IP): a serial suite sharing one page.
test.describe('admin layout audit', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }, workerInfo) => {
    const context = await browser.newContext({
      ...workerInfo.project.use,
      baseURL: workerInfo.project.use.baseURL ?? process.env.E2E_BASE_URL,
    });
    page = await context.newPage();
    await loginAsAdmin(page);
  });

  test.afterAll(async () => {
    await page.context().close();
  });

  test('every admin screen keeps the top menu and fits the viewport', async () => {
    for (const route of ROUTES) {
      await page.goto(`/admin/${route}`);
      await page.waitForLoadState('networkidle');
      await assertShellAndNoSidewaysScroll(page, route === '' ? 'dashboard' : route);
    }
  });

  for (const entity of EDITABLE) {
    test(`${entity}: edit and create open as pages inside the shell`, async () => {
      await page.goto(`/admin/tuning/entities/${entity}`);
      await page.getByRole('link', { name: /^Edit / }).first().click();
      await expect(page).toHaveURL(new RegExp(`/admin/tuning/entities/${entity}/[^/]+$`));
      await page.waitForLoadState('networkidle');
      await assertShellAndNoSidewaysScroll(page, `${entity} edit`);
      await expect(page.locator('.breadcrumb')).toBeVisible();

      await page.goBack();
      await page.getByRole('link', { name: 'Create' }).click();
      await expect(page).toHaveURL(new RegExp(`/admin/tuning/entities/${entity}/new$`));
      await assertShellAndNoSidewaysScroll(page, `${entity} create`);
    });
  }
});
