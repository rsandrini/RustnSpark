import { chromium } from '@playwright/test';
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await page.goto('http://localhost:8080/login');
await page.getByLabel('Email').fill('visual@e2e.test');
await page.getByLabel('Password').fill('visual-player-password-1');
await page
  .getByRole('button', { name: /Sign in/i })
  .last()
  .click();
await page.waitForTimeout(2500);
await page.goto('http://localhost:8080/ship');
await page.waitForTimeout(1500);
const cancel = page.getByRole('button', { name: 'Cancel mission' });
console.log('cancel buttons', await cancel.count());
while (await cancel.count()) {
  await cancel.first().click();
  await page.waitForTimeout(1500);
}
console.log(
  'dispatch buttons',
  await page.getByRole('button', { name: 'Dispatch' }).count(),
  'url',
  page.url(),
);
await b.close();
