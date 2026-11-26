import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { chromium } from 'playwright';
import { createServer as createViteServer } from 'vite';

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
