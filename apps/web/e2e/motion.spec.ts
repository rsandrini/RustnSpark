import { expect, test } from '@playwright/test';
import { registerAndLaunch } from './support';

/**
 * Reduced motion (phase 4, H4): with the system setting on, nothing in the game keeps moving: no CSS animation or
 * transition longer than a blink is running on any screen a pilot reaches.
 */
test('no animation keeps running when the pilot asked for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const running = async () =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => {
          const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
          return animation.playState === 'running' && duration > 100;
        })
        .map((animation) =>
          String((animation as CSSAnimation).animationName ?? animation.id ?? 'transition'),
        ),
    );

  await page.goto('/login');
  await page.waitForTimeout(600);
  expect(await running(), 'the landing page').toEqual([]);

  await registerAndLaunch(page, 'luna');
  for (const path of ['/ship', '/port', '/missions', '/map', '/guide']) {
    await page.goto(path);
    await page.waitForTimeout(800);
    expect(await running(), path).toEqual([]);
  }
});
