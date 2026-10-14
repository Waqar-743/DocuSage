import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('website has real assets, correct navigation, and no horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ask your PDFs');
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    for (const image of document.images) image.loading = 'eager';
    await Promise.all([...document.images].map(image => image.decode()));
  });
  expect(await page.evaluate(() => [...document.images].filter(image => !image.complete || !image.naturalWidth).map(image => image.src))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const links = await page.locator('a[href^="#"]').evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).hash));
  for (const target of new Set(links)) expect(await page.locator(target).count()).toBe(1);
  expect(errors).toEqual([]);
});

test('screenshot theme, FAQ, and mobile navigation work with accessible names', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('Which documents can I import?', { exact: true }).click();
  await expect(page.getByText(/Image-only scans need OCR/)).toBeVisible();
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toHaveAttribute('aria-expanded', 'false');
  }
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(result.violations.map(violation => ({ id: violation.id, elements: violation.nodes.map(node => node.target) }))).toEqual([]);
});

test('layout remains usable across phone, tablet, and wide desktop widths', async ({ page }, testInfo) => {
  await page.goto('./');
  const widths = testInfo.project.name === 'mobile' ? [320, 390] : [768, 1024, 1440, 1920];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(overflow, `Horizontal overflow at ${width}px`).toBe(false);
    const download = page.getByRole('link', { name: 'Download for Windows', exact: true });
    const box = await download.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  }
});
