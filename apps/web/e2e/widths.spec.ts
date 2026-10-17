import { expect, test, type Page } from '@playwright/test';
import { openPortTab, registerAndLaunch } from './support';

/**
 * Width pass (phase 4, H4): every screen at six widths, in English and in Portuguese (longer words), with no
 * sideways scroll and nothing wider than the screen. On phone widths it also reports controls smaller than a
 * finger (40 px) so they can be fixed or justified.
 */
const WIDTHS = [320, 375, 414, 768, 1024, 1280] as const;
const problems: string[] = [];
const small: Record<string, number> = {};

async function measure(page: Page, label: string, width: number): Promise<void> {
  await page.waitForTimeout(250);
  const result = await page.evaluate((phone) => {
    const screenWidth = window.innerWidth;
    const culprits = Array.from(document.body.querySelectorAll('*'))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        // a map or yard svg scrolls or zooms inside its own box: only elements that stick out of the page count
        return box.width > 0 && box.right > screenWidth + 1 && !el.closest('svg');
      })
      .slice(0, 3)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class'))}`);
    const extra = document.documentElement.scrollWidth - screenWidth;
    const tiny = phone
      ? Array.from(
          document.querySelectorAll<HTMLElement>(
            'a[href], button, select, input, summary, [role="tab"]',
          ),
        )
          .filter((el) => {
            const box = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (box.width === 0 || style.visibility === 'hidden' || el.closest('svg')) return false;
            // a checkbox or radio inside a label: the whole label is the target
            if (el.tagName === 'INPUT' && el.closest('label') !== null) return false;
            // links inside a sentence follow the text size; sr-only skips are not targets
            if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') return false;
            return box.height < 40 || box.width < 40;
          })
          .map(
            (el) =>
              `${el.tagName.toLowerCase()}.${String(el.getAttribute('class')).split(' ')[0]}[${el.getAttribute('type') ?? ''}] "${(el.textContent ?? '').trim().slice(0, 18)}${el.getAttribute('aria-label') ?? ''}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
          )
      : [];
    return { extra, culprits, tiny };
  }, width <= 414);
  if (result.extra > 1 || result.culprits.length > 0) {
    problems.push(`${label} @${width}: sideways ${result.extra}px ${result.culprits.join(', ')}`);
  }
  for (const target of result.tiny) small[target] = (small[target] ?? 0) + 1;
}

async function everywhere(page: Page, label: string): Promise<void> {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await measure(page, label, width);
  }
}

for (const language of ['en', 'pt-BR'] as const) {
  test(`every screen at six widths in ${language}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'this spec sets its own widths');
    await registerAndLaunch(page, 'luna');
    if (language === 'pt-BR') {
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByLabel('Language').selectOption('pt-BR');
      await page.keyboard.press('Escape');
    }
    const tag = (name: string) => `${language} ${name}`;

    await page.goto('/ship');
    await page.waitForTimeout(800);
    await everywhere(page, tag('/ship'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('tab').nth(1).click();
    await everywhere(page, tag('/ship store'));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/port');
    const tabs =
      language === 'en'
        ? ['Market', 'Your goods', 'Repair', 'Refuel', 'Upgrade', 'Scavenging']
        : null;
    if (tabs !== null) {
      for (const name of tabs) {
        await page.setViewportSize({ width: 1280, height: 900 });
        await openPortTab(page, name);
        await everywhere(page, tag(`/port ${name}`));
      }
    } else {
      await everywhere(page, tag('/port'));
    }

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/missions');
    await page.locator('.mrow').first().waitFor();
    await everywhere(page, tag('/missions'));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('.mrow-details summary').first().click();
    await everywhere(page, tag('/missions details'));

    for (const path of ['/map', '/map?place=ceres', '/guide', '/guide/fuel', '/profile']) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(path);
      await page.waitForTimeout(500);
      await everywhere(page, tag(path));
    }
  });
}

test.afterAll(() => {
  const summary = Object.entries(small)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} x${count}`)
    .join(', ');
  console.log(`controls under 40px on phone widths: ${summary || 'none'}`);
  expect(Object.keys(small), `controls under 40px on phone widths: ${summary}`).toEqual([]);
  expect(problems, `sideways overflow:\n${problems.join('\n')}`).toEqual([]);
});
