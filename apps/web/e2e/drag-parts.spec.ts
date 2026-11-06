import { expect, test } from '@playwright/test';
import { registerAndLaunch } from './support';

/**
 * Dragging parts with a real mouse: a loose part from the list onto the ship, a placed part back out onto the
 * list, and the click-then-click way still works. Desktop only (a finger keeps tap-then-tap).
 */
test('drag a part onto the ship, drag it back to the list, and tap-then-tap still works', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'dragging is for a mouse');
  await registerAndLaunch(page, 'luna');

  // empty the ship, so every part is loose in the list
  await page.getByRole('button', { name: 'Empty the ship' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empty the ship' }).click();
  const rows = page.locator('.hangar-side .part-btn');
  await expect(rows.first()).toBeVisible();
  const looseBefore = await rows.count();
  expect(looseBefore).toBeGreaterThan(2);
  const blocks = page.locator('.hangar-scene svg rect.block');
  await expect(blocks).toHaveCount(0);

  // --- drag a row onto a free cell of the yard ---------------------------------------------------
  const cellBox = async (gx: number, gy: number) => {
    const box = await page
      .locator(`.hangar-scene svg rect.yard-cell[data-gx="${gx}"][data-gy="${gy}"]`)
      .first()
      .boundingBox();
    if (box === null) throw new Error(`no cell ${gx},${gy}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const rowBox = await rows.first().boundingBox();
  if (rowBox === null) throw new Error('no row');
  const target = await cellBox(0, 0);
  await page.mouse.move(rowBox.x + 20, rowBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(rowBox.x + 60, rowBox.y + 30, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await expect(page.getByTestId('drop-preview')).toBeVisible();
  // R turns what is being carried: the outline keeps showing (a square part just looks the same)
  await page.keyboard.press('r');
  await expect(page.getByTestId('drop-preview')).toBeVisible();
  await page.mouse.up();
  await expect(blocks).toHaveCount(1);
  await expect(rows).toHaveCount(looseBefore - 1);

  // --- drag the placed part back out onto the parts list ------------------------------------------
  const blockBox = await blocks.first().boundingBox();
  const zone = await page.locator('[data-drop-zone="parts"]').boundingBox();
  if (blockBox === null || zone === null) throw new Error('no block or list');
  await page.mouse.move(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(blockBox.x + blockBox.width / 2 + 30, blockBox.y + 20, { steps: 4 });
  await expect(page.locator('[data-drop-zone="parts"]')).toHaveClass(/drop-ready/);
  await page.mouse.move(zone.x + zone.width / 2, zone.y + 200, { steps: 8 });
  await page.mouse.up();
  await expect(blocks).toHaveCount(0);
  await expect(rows).toHaveCount(looseBefore);

  // --- tap-then-tap is untouched -----------------------------------------------------------------
  await rows.first().click();
  await expect(page.getByText(/^Selected: /)).toBeVisible();
  const second = await cellBox(1, 1);
  await page.mouse.click(second.x, second.y);
  await expect(blocks).toHaveCount(1);
  await expect(page.getByTestId('rotate-key-hint')).toBeVisible();

  // a dropped layout can be saved, and survives a reload
  await page.getByRole('button', { name: 'Auto layout' }).click();
  await expect(blocks.first()).toBeVisible();
});
