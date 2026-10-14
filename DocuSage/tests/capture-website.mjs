// Capture the served production site and local browser measurements.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.WEB_BASE_URL || 'http://127.0.0.1:4173/DocuSage/';
await mkdir('docs/evidence', { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.addInitScript(() => {
      window.__auditCLS = 0;
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__auditCLS += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      for (const image of document.images) image.loading = 'eager';
      await Promise.all([...document.images].map(image => image.decode()));
    });
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForFunction(() => scrollY === 0);
    await page.screenshot({ path: `docs/evidence/website-${name}-hero.png` });
    await page.screenshot({ path: `docs/evidence/website-${name}.png`, fullPage: true });
    results.push(await page.evaluate(name => ({
      name, width: innerWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      layoutShift: window.__auditCLS,
      transferredBytes: performance.getEntriesByType('resource').reduce((sum, entry) => sum + entry.transferSize, 0),
      resourceRequests: performance.getEntriesByType('resource').length,
      brokenImages: [...document.images].filter(image => !image.naturalWidth).map(image => image.src),
    }), name));
    await page.close();
  }
  await writeFile('docs/evidence/website-results.json', JSON.stringify({ date: new Date().toISOString(),
    scope: 'Local production preview; network timings are not a public-host benchmark.', results }, null, 2));
} finally {
  await browser.close();
}
