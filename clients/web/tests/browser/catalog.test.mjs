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

// HS2-DZ8ZR6: the demo wires the unchanged-line controls to a fixture file, and a thread on a hidden line shows with it.
test('HS2-DZ8ZR6 the Text Diff demo reveals hidden lines and the discussion anchored on them', async () => {
  await withCatalog(async (page, url) => {
    await page.goto(`${url}?component=text-diff`);
    const demo = page.locator('[data-demo="text-diff"]');
    const middle = demo.locator('.context-expander[data-gap="1"]');
    const threads = demo.locator('[data-action^="discussion-show"]');
    await middle.waitFor();
    assert.equal(await threads.count(), 0);
    assert.equal(await demo.locator('.text-diff__cell[data-after-line="50"]').count(), 0);
    await middle.getByRole('button', { name: 'Show 20 Below', exact: true }).click();
    await demo.locator('.text-diff__cell[data-after-line="46"]').first().waitFor();
    assert.equal(await threads.count(), 0, 'the anchored line is still hidden');
    await middle.getByRole('button', { name: 'Show 20 Below', exact: true }).click();
    await demo.locator('.text-diff__cell[data-after-line="50"]').first().waitFor();
    await threads.first().waitFor();
    assert.match(await threads.first().innerText(), /easy to miss/u);
    await middle.getByRole('button', { name: 'Show 5 Lines', exact: true }).click();
    await middle.waitFor({ state: 'detached' });
    assert.equal(await demo.locator('.text-diff__range').count(), 1);
    for (const width of [900, 390, 1200]) {
      await page.setViewportSize({ width, height: 800 });
      await demo.locator('.text-diff__cell[data-after-line="50"]').first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    }
  });
});

// HS2-30ZEFE: the demos run Find for real, beside the catalog's own search.
test('HS2-30ZEFE the Diff Find Controls demo searches its diff and steps through matches', async () => {
  await withCatalog(async (page, url) => {
    await page.goto(`${url}?component=diff-find-controls`);
    const demo = page.locator('[data-demo="diff-find-controls"]');
    const marks = demo.locator('mark[data-find]');
    await demo.getByRole('button', { name: 'Next Match', exact: true }).waitFor();
    assert.equal(await demo.getByRole('button', { name: 'Next Match', exact: true }).isDisabled(), true);
    await page.keyboard.press('Control+f');
    const field = demo.getByRole('searchbox', { name: 'Find in Diff' });
    await field.waitFor();
    await page.keyboard.type('needle');
    await demo.getByText('1 of 6', { exact: true }).first().waitFor();
    // Six matches; the two context lines show on both sides of the split layout, so eight marks.
    assert.equal(await marks.count(), 8);
    assert.equal(await demo.locator('mark[data-find="current"]').count(), 2, 'the first match is on a context line');
    await page.keyboard.press('Enter');
    await demo.getByText('2 of 6', { exact: true }).first().waitFor();
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.press('Shift+Enter');
    await demo.getByText('6 of 6', { exact: true }).first().waitFor();
    await field.fill('absent');
    await demo.getByText('No matches', { exact: true }).first().waitFor();
    assert.equal(await marks.count(), 0);
  });
});

test('HS2-30ZEFE the Text Diff demo finds in lines it reveals', async () => {
  await withCatalog(async (page, url) => {
    await page.goto(`${url}?component=text-diff`);
    const demo = page.locator('[data-demo="text-diff"]');
    await demo.locator('.context-expander[data-gap="1"]').waitFor();
    await page.keyboard.press('Control+f');
    await demo.getByRole('searchbox', { name: 'Find in Diff' }).waitFor();
    await page.keyboard.type('unchanged50');
    await demo.getByText('No matches', { exact: true }).first().waitFor();
    await demo
      .locator('.context-expander[data-gap="1"]')
      .getByRole('button', { name: 'Show 20 Below', exact: true })
      .click();
    await demo
      .locator('.context-expander[data-gap="1"]')
      .getByRole('button', { name: 'Show 20 Below', exact: true })
      .click();
    await demo.getByText('1 of 1', { exact: true }).first().waitFor();
    // A revealed context line sits on both sides of the split layout, so its match is marked twice.
    assert.equal(await demo.locator('mark[data-find="current"]').count(), 2);
  });
});

// HS2-FTEQVQ: the navigator demo marks files for real against fixture marks.
test('HS2-FTEQVQ the Review Navigator demo shows marks and counts only reviewed files', async () => {
  await withCatalog(async (page, url) => {
    await page.goto(`${url}?component=review-navigator`);
    const example = page.locator('#demo-review-progress');
    const rows = (title) => example.locator(`[title="${title}"]`);
    await rows('Reviewed').first().waitFor();
    assert.equal(await rows('Changed Since Reviewed').count(), 1);
    assert.match(await example.innerText(), /Files Reviewed\s+1 of 4/u);
    const mark = example.getByRole('button', { name: 'Mark Reviewed', exact: true });
    await mark.waitFor();
    assert.equal(await mark.getAttribute('aria-pressed'), 'false');
    await mark.click();
    await page.waitForFunction(() =>
      /Files Reviewed\s+2 of 4/u.test(document.getElementById('demo-review-progress')?.innerText ?? ''),
    );
    assert.equal(await mark.getAttribute('aria-pressed'), 'true');
    await mark.click();
    await page.waitForFunction(() =>
      /Files Reviewed\s+1 of 4/u.test(document.getElementById('demo-review-progress')?.innerText ?? ''),
    );
  });
});

// GB2-8T670B: the More Tools demo shows the menu in a narrow toolbar and each entry answers.
test('GB2-8T670B the More Tools demo opens its menu and records the chosen entry', async () => {
  await withCatalog(async (page, url) => {
    await page.goto(`${url}?component=comparison-tools-menu`);
    const demo = page.locator('[data-demo="comparison-tools-menu"]');
    const result = demo.locator('[data-demo-tools-result]');
    await result.getByText('Nothing chosen yet.').waitFor();
    const tools = demo.getByRole('button', { name: 'More Tools', exact: true });
    await tools.waitFor();
    await tools.click();
    const entry = (name) => page.locator('[role^="menuitem"]').filter({ hasText: new RegExp(`^${name}$`, 'u') });
    assert.equal(await entry('Inline').getAttribute('aria-checked'), 'true');
    assert.equal(await entry('Wrap').getAttribute('aria-checked'), 'true');
    assert.equal(await entry('Symbol Outline').isDisabled(), true, 'an unavailable tool is disabled, not hidden');
    await entry('Find in Diff').click();
    await result.getByText('Find in Diff chosen.').waitFor();
    await tools.click();
    await entry('Wrap').click();
    await result.getByText('Wrap chosen.').waitFor();
    await page.keyboard.press('Escape');
    await tools.click();
    assert.equal(await entry('Wrap').getAttribute('aria-checked'), 'false', 'the checked state follows the choice');
  });
});

// GB2-X1EATS: the discussion demo follows an AI note's source links with fixture answers.
test('GB2-X1EATS the Review Discussion demo follows a source link and a cited commit', async () => {
  await withCatalog(async (page, url) => {
    await page.goto(`${url}?component=review-discussion`);
    const demo = page.locator('[data-demo="review-discussion"]');
    const result = demo.locator('[data-demo-link-result]');
    assert.equal(await result.innerText(), 'No link followed yet.');
    await demo.locator('[data-action="discussion-show:3"]').click();
    const inspector = demo.locator('.discussion-inspector');
    const commit = inspector.getByRole('button', { name: 'the earlier fix', exact: true });
    assert.equal(await commit.getAttribute('title'), 'Opens commit abcdef1234 in a new review');
    assert.equal(await inspector.getByRole('button', { name: 'the helper', exact: true }).getAttribute('title'), null);
    await inspector.getByRole('button', { name: 'the helper', exact: true }).click();
    await result.getByText('Revealed src/bundle-paths.ts line 12 in this review.').waitFor();
    await commit.click();
    await result.getByText('Opened commit abcdef1 at src/bundle.ts line 8 in a new review.').waitFor();
  });
});

// HS2-TGAGQ4: the discussion demo moves its thread for real.
test('HS2-TGAGQ4 the Review Discussion demo moves a thread to another line and side', async () => {
  await withCatalog(async (page, url) => {
    await page.goto(`${url}?component=review-discussion`);
    const inspector = page.locator('[data-demo="review-discussion"] .discussion-inspector');
    await inspector.getByRole('button', { name: 'Move Comment', exact: true }).waitFor();
    await inspector.getByRole('button', { name: 'Move Comment', exact: true }).click();
    await inspector.getByRole('spinbutton', { name: 'Move to Line' }).fill('30');
    await inspector.getByRole('button', { name: 'Move', exact: true }).click();
    await inspector.getByText(/After line 30/u).waitFor();
    await inspector.getByRole('button', { name: 'Move Comment', exact: true }).click();
    await inspector.getByRole('button', { name: 'Cancel', exact: true }).click();
    await inspector.getByText(/After line 30/u).waitFor();
    assert.equal(await inspector.getByRole('spinbutton', { name: 'Move to Line' }).count(), 0);
  });
});

// HS2-5P1B23: the navigator lists files in risk and narrative order and returns to the path tree.
test('HS2-5P1B23 the Review Navigator demo orders files by risk and narrative and returns to the tree', async () => {
  await withCatalog(async (page, url) => {
    await page.goto(`${url}?component=review-navigator`);
    const example = page.locator('#demo-review-order');
    const names = () =>
      example.locator('[role="treeitem"]').evaluateAll((items) => items.map((item) => item.textContent?.trim() ?? ''));
    await example.getByRole('treeitem', { name: /Highest Risk First/u }).waitFor();
    // GB2-173Q1Q: the selected order says what it does, and each choice carries the same words as its tooltip.
    await example.getByText('Highest risk first. Runs a risk analysis.', { exact: true }).waitFor();
    assert.equal(
      await example.locator('[data-segment-value="risk"]').getAttribute('title'),
      'Highest risk first. Runs a risk analysis.',
    );
    assert.equal(await example.locator('[data-segment-value="path"]').getAttribute('title'), 'A to Z by path.');
    let rows = await names();
    const at = (rows, text) => rows.findIndex((row) => row.includes(text));
    assert(at(rows, 'settings.ts') < at(rows, 'bundle.ts'), 'highest risk first');
    assert(at(rows, 'bundle.ts') < at(rows, 'bundle.test.ts'));
    assert(at(rows, 'bundle.test.ts') < at(rows, 'Not Analyzed'), 'unscored files follow');
    assert(
      rows.some((row) => row.includes('README.md')),
      'every file stays listed',
    );
    assert(rows.some((row) => row.includes('High Risk')));
    await example
      .getByRole('treeitem', { name: /bundle\.ts/u })
      .first()
      .click();

    await example.locator('[data-segment-value="narrative"]').click();
    await example.getByRole('treeitem', { name: /Review in This Order/u }).waitFor();
    await example.getByText('In reading order. Runs an analysis.', { exact: true }).waitFor();
    assert.equal(
      await example.getByText('Highest risk first. Runs a risk analysis.').count(),
      0,
      'one description at a time',
    );
    rows = await names();
    assert(at(rows, 'bundle.ts') < at(rows, 'settings.ts'), 'narrative order');
    assert(rows.some((row) => row.includes('Step 1')));
    assert(at(rows, 'Not in the Narrative') > at(rows, 'settings.ts'));

    await example.locator('[data-segment-value="path"]').click();
    await example.getByRole('treeitem', { name: /^src$/u }).waitFor();
    await example.getByText('A to Z by path.', { exact: true }).waitFor();
    rows = await names();
    assert(!rows.some((row) => row.includes('Highest Risk First')), 'the path tree is back');
  });
});
