import { expect, test } from '@playwright/test';
import { registerAndLaunch } from './support';

// The mentor talks to the pilot (docs/design/mentor-dialogue-plan.md) on the real stack: the welcome opens on the
// first Ship screen, branches into the faction's story, hands over to the ship scene, and the account menu can play
// a scene again or turn the dialogues off. Reduced motion shows each text at once.
test.use({ reducedMotion: 'reduce' });

test('the welcome: the leader, a lore branch, the ship scene pointing at the grid, then the account menu replays it', async ({
  page,
}) => {
  await registerAndLaunch(page, 'luna', { dialogues: true });
  await page.goto('/ship');

  // the welcome: centred, dimmed, from the luna mentor
  const box = page.getByRole('dialog');
  await expect(box).toBeVisible({ timeout: 20_000 });
  await expect(box).toContainText('Ines Moura');
  await expect(box).toContainText('Dockmaster');
  await expect(box).toContainText('Welcome to Ceres');
  await expect(page.locator('.dialogue-backdrop')).toBeVisible();
  await box.getByRole('button', { name: 'Continue' }).click();

  // the faction pitch, with a lore branch that comes back to the main line
  await expect(page.getByRole('dialog')).toContainText('Luna Authority keeps the lanes open');
  await page.getByRole('button', { name: /Tell me about the Authority/ }).click();
  await expect(page.getByRole('dialog')).toContainText('one seal, one set of rules');
  await page.getByRole('button', { name: 'What do I do now?' }).click();
  await expect(page.getByRole('dialog')).toContainText('You fly contracts');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('dialog')).toContainText('First, your ship');
  await page.getByRole('button', { name: 'Show me the ship' }).click();

  // the ship scene follows (after a breather), pointing at the ship grid with a ring
  const ship = page.getByRole('dialog');
  await expect(ship).toContainText('This is your ship', { timeout: 20_000 });
  await expect(page.locator('.dialogue-ring')).toBeVisible();
  await expect(page.locator('.dialogue-backdrop')).toHaveCount(0); // not blocking: the game stays usable
  await expect(page.getByRole('button', { name: 'Auto layout' })).toBeEnabled();
  // skip the rest of this scene without a question (only the welcome asks)
  await ship.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('dialogue')).toHaveCount(0);

  // the account menu offers the welcome again, and a switch for all dialogues
  await page.getByRole('button', { name: 'Account menu' }).click();
  const menu = page.getByTestId('menu-dialogue');
  await expect(menu).toContainText('Hear it again: The welcome');
  await menu.getByRole('button', { name: 'Turn dialogues off' }).click();
  await expect(menu.getByRole('button', { name: 'Turn dialogues on' })).toBeVisible();
  await menu.getByRole('button', { name: /Hear it again: The welcome/ }).click();
  // dialogues are off: the replay waits and nothing opens
  await page.waitForTimeout(3500);
  await expect(page.getByTestId('dialogue')).toHaveCount(0);
});

test('skipping the welcome asks first, and a skipped scene does not come back on reload', async ({
  page,
}) => {
  await registerAndLaunch(page, 'sun', { dialogues: true });
  await page.goto('/ship');
  const box = page.getByRole('dialog');
  await expect(box).toBeVisible({ timeout: 20_000 });
  await expect(box).toContainText('Tomas Verhoeven');
  await box.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByText(/Skip the whole conversation/)).toBeVisible();
  await page.getByRole('button', { name: 'No, go on' }).click();
  await expect(page.getByRole('dialog')).toContainText('Welcome to Hedus');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Yes, skip it' }).click();
  await expect(page.getByTestId('dialogue')).toHaveCount(0);

  // the welcome never returns; the next scene (the ship) is the one that opens
  await page.reload();
  const next = page.getByRole('dialog');
  await expect(next).toBeVisible({ timeout: 20_000 });
  await expect(next).not.toContainText('Welcome to Hedus');
});

test('the explorers open with their own leader', async ({ page }) => {
  await registerAndLaunch(page, 'explorers', { dialogues: true });
  await page.goto('/ship');
  await expect(page.getByRole('dialog')).toContainText('Vik Adeyemi', { timeout: 20_000 });
});

test('on a 320 px phone the box is a sheet inside the screen with tappable buttons, in Portuguese too', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await registerAndLaunch(page, 'luna', { dialogues: true });
  await page.goto('/ship');
  const box = page.getByRole('dialog');
  await expect(box).toBeVisible({ timeout: 20_000 });
  const fits = async () => {
    const rect = await box.boundingBox();
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(320);
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(640);
    for (const button of await box.getByRole('button').all()) {
      const size = await button.boundingBox();
      expect(size!.height).toBeGreaterThanOrEqual(40);
    }
  };
  await fits();
  // the long lore node, in Portuguese
  const refreshed = await page.request.post('/v1/auth/refresh');
  const { accessToken } = (await refreshed.json()) as { accessToken: string };
  await page.request.post('/v1/players/me/locale', {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { locale: 'pt-BR' },
  });
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('button', { name: /Fale sobre a Autoridade/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Antes da Autoridade');
  await fits();
});
