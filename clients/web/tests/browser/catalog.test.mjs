import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

async function withCatalog(run) {
  const vite = await createViteServer({
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
  });
  const server = createServer(vite.middlewares);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch();
  try {
    await run(
      await browser.newPage({ viewport: { width: 1200, height: 800 } }),
      `http://127.0.0.1:${server.address().port}/ux-demo/`,
    );
  } finally {
    await browser.close();
    server.close();
    await vite.close();
  }
}

// HS2-S9EG8B: Kerf's composed catalog supplies the library groups and the relationships.
test('HS2-S9EG8B the catalog composes Kerf libraries, links both ways and keeps older links', async () => {
  await withCatalog(async (page, url) => {
    const related = () => page.getByRole('button', { name: 'Components', exact: true });
    await page.goto(`${url}?component=saved-review-dialog`);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-component="toolbar-text"][data-size="xlarge"]')?.textContent?.trim() ===
        'Saved Reviews',
    );
    const groups = page.locator('[data-action="catalog-toggle-secondary"]');
    assert.deepEqual(await groups.allTextContents(), ['Kerf UI', 'Web Awesome']);
    for (const group of await groups.all()) assert.equal(await group.getAttribute('aria-expanded'), 'false');
    await related().click();
    await page.getByRole('menuitem', { name: /^Button\b/ }).waitFor();
    await page.keyboard.press('Escape');
    await groups.first().click();
    assert.equal(await groups.first().getAttribute('aria-expanded'), 'true');
    assert.equal(await groups.last().getAttribute('aria-expanded'), 'false');
    await page
      .locator('[data-action="catalog-select"]', { hasText: /^Button$/ })
      .first()
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-component="toolbar-text"][data-size="xlarge"]')?.textContent?.trim() === 'Button',
    );
    assert.match(page.url(), /component=%40kerfjs%2Fui%3Abutton|component=@kerfjs\/ui:button/);
    await related().click();
    await page.getByRole('menuitem', { name: /^Saved Reviews\b/ }).click();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-component="toolbar-text"][data-size="xlarge"]')?.textContent?.trim() ===
        'Saved Reviews',
    );
    const filter = page.locator('[data-action="catalog-toggle-secondary-filter"]');
    await groups.last().click();
    const before = await page.locator('[data-action="catalog-select"]').count();
    await filter.click();
    assert((await page.locator('[data-action="catalog-select"]').count()) > before, 'Discouraged entries appear');
    await page.goto(`${url}?component=${encodeURIComponent('@kerfjs/ui:badge')}`);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-component="toolbar-text"][data-size="xlarge"]')?.textContent?.trim() === 'Badge',
    );
    assert.equal(await groups.first().getAttribute('aria-expanded'), 'true');
  });
});

// HS2-T9J9BE: the catalog's contrast control uses Kerf's shared preview, not copied token overrides.
test('HS2-T9J9BE the catalog contrast control drives Kerf’s increased-contrast preview', async () => {
  const vite = await createViteServer({
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
  });
  const server = createServer(vite.middlewares);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/ux-demo/`);
    const toggle = page.locator('[data-action="catalog-toggle-contrast"]');
    await toggle.waitFor();
    const contrast = () => page.evaluate(() => document.documentElement.dataset.kuiContrast ?? null);
    const border = () =>
      page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--kui-color-neutral-border-normal'));
    assert.equal(await contrast(), null);
    const normal = await border();
    await toggle.click();
    assert.equal(await contrast(), 'more');
    assert.notEqual(await border(), normal, 'Kerf swaps its own tokens for increased contrast');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('catalog-contrast')), false);
    await toggle.click();
    assert.equal(await contrast(), null);
    assert.equal(await border(), normal);
  } finally {
    await browser.close();
    server.close();
    await vite.close();
  }
});
