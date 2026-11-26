import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium, webkit } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const executable = join(root, 'target', 'debug', `glassbox-server${process.platform === 'win32' ? '.exe' : ''}`);
const captures = process.env.GLASSBOX_BROWSER_CAPTURES;
const browserType = process.env.GLASSBOX_BROWSER === 'webkit' ? webkit : chromium;

function svg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e7eaef"/><circle cx="160" cy="90" r="62" fill="${color}"/><script>window.mediaScriptRan = true</script></svg>`;
}

async function seedReview(scratch) {
  const repo = join(scratch, 'Fieldnotes');
  await mkdir(repo);
  const [file, image] = ['bundle.ts', 'mark.svg'].map((name) => join(repo, name));
  const diagram = join(repo, 'flow.dot');
  const long = join(repo, 'long.txt');
  const git = (...args) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
      cwd: repo,
      windowsHide: true,
    });
  git('init', '-q', '--initial-branch=review');
  await writeFile(file, 'export const revision = 1;\n');
  await writeFile(image, svg('#506b91'));
  await writeFile(diagram, 'digraph { a -> b }\n');
  await writeFile(long, Array.from({ length: 100 }, (_, index) => `old ${index}\n`).join(''));
  git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
  await writeFile(file, 'export const revision = 2;\n');
  await writeFile(image, svg('#3b7c68'));
  await writeFile(diagram, 'digraph { a -> c }\n');
  await writeFile(long, Array.from({ length: 100 }, (_, index) => `new ${index}\n`).join(''));
  const before = join(scratch, 'before.txt');
  const after = join(scratch, 'after.txt');
  await writeFile(before, 'before\n');
  await writeFile(after, 'after\n');
  return { repo, before, after };
}

async function capture(page, name) {
  if (!captures) return;
  await mkdir(captures, { recursive: true });
  await page.screenshot({ path: join(captures, `${name}.png`), animations: 'disabled' });
}

async function exerciseWorkbench(page, url, paths, settings) {
  const role = (name, label) => page.getByRole(name, { name: label, exact: typeof label === 'string' });
  const button = (name) => role('button', name);
  const input = (name) => role('textbox', name);
  const comment = async (text, side) => {
    const inspector = role('region', 'Discussion');
    await inspector.getByText(side).waitFor();
    await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill(text);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/discussion') && response.request().postDataJSON().operation?.kind === 'create',
    );
    await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
    const response = await created;
    assert(response.ok(), await response.text());
  };

  await page.goto(url);
  await input('Repository Path').fill(paths.repo);
  await button('Open Comparison').click();
  await role('treeitem', /bundle\.ts/).click();
  await button('Inline').click();
  assert.equal(await button('Inline').getAttribute('aria-pressed'), 'true');
  await button('Wrap').click();
  assert.equal(await button('Wrap').getAttribute('aria-pressed'), 'false');
  await button('Add Comment to After Line 1').focus();
  await page.keyboard.press('Enter');
  await comment('Check the next revision.', /After line 1/);

  await role('treeitem', /mark\.svg/).click();
  await role('img', 'After image').waitFor();
  await page.waitForFunction(() => document.querySelector('img[data-media-side="after"]')?.naturalWidth > 0);
  assert.match(await role('img', 'After image').getAttribute('src'), /^data:image\/svg\+xml;base64,/u);
  assert.equal(await page.evaluate(() => Reflect.has(window, 'mediaScriptRan')), false);
  await button('SVG Source').click();
  assert.equal(await page.locator('.media-diff pre').count(), 2);
  await button('Side by Side').click();
  await button('Add Region Comment').focus();
  await page.keyboard.press('Enter');
  const before = page.locator('[data-media-region-side="before"]');
  await before.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  await page.getByRole('status').filter({ hasText: 'Before region at 40%' }).waitFor();
  await page.keyboard.press('Enter');
  await comment('Check the previous mark.', /Before image region/);
  await role('button', /Open Region Comment/).waitFor();

  await button('Appearance').click();
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
  );
  await role('menuitemcheckbox', 'Dark').click();
  assert((await saved).ok());
  assert.equal(JSON.parse(await readFile(join(settings, 'settings.json'), 'utf8')).appearance, 'dark');
  await page.waitForFunction(() => document.documentElement.dataset.kuiScheme === 'dark');
  for (const width of [1440, 940, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await role('button', /Open Region Comment/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await capture(page, `workbench-${width}`);
  }

  await button('Change Source').click();
  await role('combobox', 'Compare').click();
  await role('option', 'Files or Folders').click();
  await input('Before Path').fill(paths.before);
  await input('After Path').fill(paths.after);
  await button('Open Comparison').click();
  await role('treeitem', /after\.txt/).click();
  await page.locator('.text-diff').getByText('after', { exact: true }).waitFor();
}

// HS2-04T93G: a dialog's title, content and footer share one inset. The title and a content line start on
// the same x, and the footer's right inset equals that left inset.
async function assertDialogInset(dialog, content) {
  const edges = await dialog.evaluate((root, text) => {
    const textLeft = (element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getBoundingClientRect().left;
    };
    const frame = root.getBoundingClientRect();
    const line = [...root.querySelectorAll('*')].find(
      (element) => element.children.length === 0 && element.textContent?.trim() === text,
    );
    const last = [...root.querySelectorAll('button')].at(-1);
    return {
      titleLeft: textLeft(root.querySelector('h2')) - frame.left,
      contentLeft: textLeft(line) - frame.left,
      footerRight: frame.right - last.getBoundingClientRect().right,
    };
  }, content);
  assert(
    Math.abs(edges.titleLeft - edges.contentLeft) <= 1.5,
    `title and content edges differ: ${JSON.stringify(edges)}`,
  );
  assert(
    Math.abs(edges.footerRight - edges.titleLeft) <= 1.5,
    `footer inset differs from the title's: ${JSON.stringify(edges)}`,
  );
}

async function withWorkbench(exercise, { launchArgs = () => [], renderer = false, provider = false } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'glassbox-browser-'));
  const settings = join(scratch, 'settings');
  let host;
  let reader;
  let exited;
  let browser;
  try {
    const paths = await seedReview(scratch);
    const rendererPath = renderer ? join(scratch, `renderer${process.platform === 'win32' ? '.exe' : ''}`) : '';
    if (renderer) {
      const fixture = join(root, 'crates', 'glassbox-server', 'tests', 'fixtures', 'diagram_renderer.rs');
      execFileSync('rustc', [fixture, '-o', rendererPath], { windowsHide: true });
    }
    const providerHome = join(scratch, 'providers');
    if (provider) {
      await mkdir(providerHome);
      const fixture = join(root, 'crates', 'glassbox-server', 'tests', 'fixtures', 'analysis_provider.rs');
      const executable = join(providerHome, `analysis-fixture${process.platform === 'win32' ? '.exe' : ''}`);
      execFileSync('rustc', ['--edition=2024', fixture, '-o', executable], { windowsHide: true });
      for (const [id, name] of [
        ['desktop', 'Desktop Fixture'],
        ['unapproved', 'Unapproved Fixture'],
      ]) {
        await writeFile(join(providerHome, `${id}.json`), JSON.stringify({ version: 1, id, name, executable }));
      }
    }
    async function restart() {
      reader?.close();
      host?.kill();
      await exited;
      host = spawn(executable, ['--assets', join(root, 'clients', 'web', 'dist'), ...launchArgs(paths)], {
        cwd: root,
        env: {
          ...process.env,
          GLASSBOX_SETTINGS_DIRECTORY: settings,
          GLASSBOX_FEEDBACK_DIRECTORY: join(scratch, 'feedback'),
          GLASSBOX_CONTENT_RENDERER: rendererPath,
          GLASSBOX_AI_PROVIDER_DIRECTORY: provider ? providerHome : '',
          GLASSBOX_AI_PROVIDER: '',
          GLASSBOX_AI_TRUSTED_PROVIDERS: provider ? 'desktop' : '',
        },
        stdio: ['ignore', 'pipe', 'inherit'],
        windowsHide: true,
      });
      exited = new Promise((resolve) => {
        host.once('close', resolve);
      });
      reader = createInterface({ input: host.stdout });
      const [address] = await Promise.race([
        once(reader, 'line', { signal: AbortSignal.timeout(10_000) }),
        once(host, 'exit').then(([code]) => {
          throw new Error(`Glassbox host exited before readiness with code ${code}`);
        }),
      ]);
      assert.match(address, /^127\.0\.0\.1:\d+$/u);
      return `http://${address}`;
    }
    const url = await restart();
    browser = await browserType.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    try {
      await exercise(page, url, paths, settings, restart);
      assert.deepEqual(errors, []);
    } catch (error) {
      await capture(page, 'workbench-failure');
      throw error;
    }
  } finally {
    try {
      await browser?.close();
    } finally {
      reader?.close();
      host?.kill();
      await exited;
      await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

test('built workbench reviews Git and direct files with persistent preferences', { timeout: 60_000 }, async () => {
  await withWorkbench(exerciseWorkbench);
});

test('HS2-V6962Y keeps wrapped code within its diff row after a compact resize', { timeout: 60_000 }, async () => {
  await withWorkbench(async (page, url, { repo }) => {
    const text = 'export async function writeBundle(review: Review) { return bundlePath(review.id); }';
    await writeFile(join(repo, 'bundle.ts'), `${text}\nconst nextLine = true;\n`);
    const button = (name) => page.getByRole('button', { name, exact: true });
    await page.goto(url);
    await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
    await button('Open Comparison').click();
    await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
    await button('Inline').click();
    const cell = page.locator('.text-diff__cell[data-after-line="1"]');
    await cell.getByText('writeBundle', { exact: false }).first().waitFor();
    for (const width of [940, 390, 1440]) {
      await page.setViewportSize({ width, height: 880 });
      const bounds = await cell.evaluate((element) => {
        const range = document.createRange();
        const code = element.querySelector('code');
        range.selectNodeContents(code);
        const row = element.getBoundingClientRect();
        const lines = range.getBoundingClientRect();
        return {
          lineCount: new Set(Array.from(range.getClientRects(), ({ top }) => top)).size,
          row: row.bottom,
          text: lines.bottom,
          whitespace: getComputedStyle(code).whiteSpace,
        };
      });
      if (width === 390) assert(bounds.lineCount > 1, 'Fixture should wrap in the compact view');
      assert.equal(bounds.whitespace, 'break-spaces');
      assert(bounds.text <= bounds.row, `Wrapped text extends below its row at ${width}px: ${JSON.stringify(bounds)}`);
    }
    await page.setViewportSize({ width: 390, height: 880 });
    await button('Side by Side').click();
    await button('Wrap').click();
    const unwrapped = page.locator('.text-diff__cell[data-after-line="1"] code');
    assert.equal(await unwrapped.evaluate((code) => getComputedStyle(code).whiteSpace), 'pre');
    const diff = page.getByRole('region', { name: 'Text Diff', exact: true });
    assert(await diff.evaluate((element) => element.scrollWidth > element.clientWidth));
  });
});

test(
  'HS2-JEM47K keeps every wrapped diff cell inside its row across split and inline resizes',
  { timeout: 90_000 },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const wrapped = (name) => `export async function ${name}(review: Review) { return bundlePath(review.id); }`;
      await writeFile(
        join(repo, 'bundle.ts'),
        [
          'const first = 1;',
          wrapped('writeBundle'),
          'const second = path + ".tmp";',
          wrapped('readBundle'),
          'const third = 3;',
        ]
          .join('\n')
          .concat('\n'),
      );
      const button = (name) => page.getByRole('button', { name, exact: true });
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
      await page.getByText('writeBundle', { exact: false }).first().waitFor();
      // A comment card sits between rows, as in the reviewed layouts.
      await button('Add Comment to After Line 2').focus();
      await page.keyboard.press('Enter');
      const inspector = page.getByRole('region', { name: 'Discussion', exact: true });
      await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill('Check the name.');
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith('/discussion') && response.request().postDataJSON().operation?.kind === 'create',
      );
      await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
      assert((await created).ok());

      const clippedCells = () =>
        page.evaluate(() => {
          const clipped = [];
          let wrappedCells = 0;
          for (const cell of document.querySelectorAll('.text-diff__cell')) {
            const code = cell.querySelector('code');
            if (!code) continue;
            const range = document.createRange();
            range.selectNodeContents(code);
            const lines = new Set(Array.from(range.getClientRects(), ({ top }) => Math.round(top))).size;
            if (lines > 1) wrappedCells += 1;
            if (range.getBoundingClientRect().bottom > cell.getBoundingClientRect().bottom + 1) {
              clipped.push({ line: cell.dataset.afterLine ?? cell.dataset.beforeLine, side: cell.dataset.side, lines });
            }
          }
          return {
            clipped,
            wrappedCells,
            gridAutoRows: getComputedStyle(document.querySelector('.text-diff__lines')).gridAutoRows,
          };
        });
      const resizeThrough = async (label, widths) => {
        for (const width of widths) {
          await page.setViewportSize({ width, height: 880 });
          await page.waitForTimeout(150);
          const result = await clippedCells();
          assert.equal(result.gridAutoRows, 'min-content', `${label} rows must size to their content at ${width}px`);
          assert.deepEqual(result.clipped, [], `${label} clips wrapped code at ${width}px`);
          if (width === 390) assert(result.wrappedCells > 0, `${label} fixture should wrap at 390px`);
        }
      };

      await resizeThrough('Side by Side', [1440, 940, 390, 1440, 390]);
      await page.setViewportSize({ width: 1440, height: 880 });
      await button('Inline').click();
      await resizeThrough('Inline', [940, 390, 1440, 390]);
    });
  },
);

test(
  'HS2-Q46BRQ closes an overlay navigator after a file is chosen and keeps a docked one open',
  { timeout: 60_000 },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const button = (name) => page.getByRole('button', { name, exact: true });
      const railOpen = () =>
        page.evaluate(() => {
          const rail = document.querySelector('[aria-label="Changed Files"]');
          return rail !== null && !rail.inert && rail.getAttribute('aria-hidden') !== 'true';
        });
      const closed = () =>
        page.waitForFunction(() => {
          const rail = document.querySelector('[aria-label="Changed Files"]');
          return rail === null || rail.inert || rail.getAttribute('aria-hidden') === 'true';
        });

      await page.setViewportSize({ width: 1440, height: 880 });
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
      await page.getByRole('heading', { name: 'bundle.ts', exact: true }).waitFor();
      assert.equal(await railOpen(), true, 'A docked navigator stays open after a file is chosen');

      await page.setViewportSize({ width: 390, height: 880 });
      await closed();
      await button('Show Files').first().click();
      assert.equal(await railOpen(), true, 'Show Files opens the overlay');
      await page.getByRole('treeitem', { name: /long\.txt/ }).click();
      await closed();
      await page.getByRole('heading', { name: 'long.txt', exact: true }).waitFor();
      await page.locator('.text-diff').first().waitFor();
      const covered = await page.evaluate(() => {
        const diff = document.querySelector('.text-diff');
        const box = diff?.getBoundingClientRect();
        if (diff === null || box === undefined) return true;
        const top = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height, 40) / 2);
        return top === null || !diff.contains(top);
      });
      assert.equal(covered, false, 'The chosen diff is visible once the overlay closes');

      await button('Show Files').first().click();
      assert.equal(await railOpen(), true, 'Show Files reopens the overlay');
      await page.getByRole('treeitem', { name: /long\.txt/ }).click();
      await closed();
    });
  },
);

test('changed-file clipboard preserves spaces and paths for deleted Git entries', { timeout: 60_000 }, async () => {
  await withWorkbench(async (page, url, { repo }) => {
    const live = 'source with spaces.txt';
    const deleted = 'removed with spaces.txt';
    const checkout = await realpath(repo);
    const git = (...args) =>
      execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
        cwd: repo,
        windowsHide: true,
      });
    await writeFile(join(repo, live), 'before\n');
    await writeFile(join(repo, deleted), 'before removal\n');
    git('add', live, deleted);
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'clipboard fixtures');
    await writeFile(join(repo, live), 'after\n');
    await rm(join(repo, deleted));

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await page.goto(url);
    const button = (name) => page.getByRole('button', { name, exact: true });
    await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
    await button('Open Comparison').click();
    for (const name of [live, deleted]) {
      await page.getByRole('treeitem', { name: new RegExp(name.replaceAll('.', '\\.')) }).click();
      await button('Copy Relative Path').click();
      await page.getByRole('status').filter({ hasText: 'Relative path copied.' }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), name);
      await button('Copy Absolute Path').click();
      await page.getByRole('status').filter({ hasText: 'Absolute path copied.' }).waitFor();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(copied.replaceAll('\\', '/'), join(checkout, name).replaceAll('\\', '/'));
    }
    await button('Open in Default Editor').click();
    await page.getByRole('status').filter({ hasText: 'There is no live file at the comparison path.' }).waitFor();
  });
});

test('definition navigation restores diff and read-only destinations with history', { timeout: 60_000 }, async () => {
  await withWorkbench(async (page, url, { repo }) => {
    const git = (...args) =>
      execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
        cwd: repo,
        windowsHide: true,
      });
    const current = join(repo, 'bundle.ts');
    await writeFile(current, 'export const revision = sharedTarget();\n');
    await writeFile(join(repo, 'shared.ts'), 'export function sharedTarget() { return 1; }\n');
    await writeFile(join(repo, 'changed-target.ts'), 'export function changedTarget() { return 1; }\n');
    git('add', 'bundle.ts', 'shared.ts', 'changed-target.ts');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'definition fixtures');
    await writeFile(
      current,
      'export function localTarget() { return 2; }\nexport const revision = localTarget() + sharedTarget() + changedTarget() + missingTarget();\n',
    );
    await writeFile(join(repo, 'changed-target.ts'), 'export function changedTarget() { return 3; }\n');
    const modifiers = [process.platform === 'darwin' ? 'Meta' : 'Control'];
    const button = (name) => page.getByRole('button', { name, exact: true });
    const heading = (name) => page.getByRole('heading', { name, exact: true });
    const symbol = (side, line, name) =>
      page.locator(`[data-${side}-line="${line}"] [data-token="symbol"]`).getByText(name, { exact: true });
    const target = page.locator('[data-definition-target]');
    await page.goto(url);
    await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
    await button('Open Comparison').click();
    await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
    await symbol('after', 2, 'localTarget').click({ modifiers });
    await target.filter({ hasText: 'function localTarget' }).waitFor();
    assert.equal(await target.getAttribute('data-after-line'), '1');

    await symbol('before', 1, 'sharedTarget').click({ modifiers });
    await heading('shared.ts').waitFor();
    const readOnly = page.getByRole('region', { name: 'Read-Only Source', exact: true });
    await readOnly.waitFor();
    assert.equal(await readOnly.locator('.text-diff__cell').count(), 1);
    assert.equal(await target.getAttribute('data-before-line'), '1');
    for (const width of [1440, 940, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await readOnly.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await capture(page, `definition-source-${width}`);
    }
    await button('Previous File Visit').click();
    await heading('bundle.ts').waitFor();
    await target.filter({ hasText: 'function localTarget' }).waitFor();
    await button('Next File Visit').click();
    await heading('shared.ts').waitFor();
    await button('Previous File Visit').click();
    await heading('bundle.ts').waitFor();

    await symbol('after', 2, 'missingTarget').click({ modifiers });
    await page.getByRole('status').filter({ hasText: 'No definition found for missingTarget.' }).waitFor();
    await symbol('after', 2, 'changedTarget').click({ modifiers });
    await heading('changed-target.ts').waitFor();
    await page.getByRole('region', { name: 'Text Diff', exact: true }).waitFor();
    await target.filter({ hasText: 'return 3' }).waitFor();
    assert.equal(await target.getAttribute('data-after-line'), '1');
    assert.equal(await button('Next File Visit').isDisabled(), true);
    await capture(page, 'definition-in-diff');
  });
});

test('definition navigation resolves JavaScript and Python on the clicked Git side', { timeout: 60_000 }, async () => {
  await withWorkbench(async (page, url, { repo }) => {
    const git = (...args) =>
      execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
        cwd: repo,
        windowsHide: true,
      });
    await writeFile(join(repo, 'entry.cjs'), 'const revision = sharedValue();\n');
    await writeFile(join(repo, 'shared.ts'), 'export function sharedValue() { return 1; }\n');
    await writeFile(join(repo, 'entry.py'), 'revision = fetch_value()\n');
    await writeFile(join(repo, 'shared.pyi'), 'def fetch_value() -> int: ...\n');
    git('add', 'entry.cjs', 'shared.ts', 'entry.py', 'shared.pyi');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'definition fixtures');
    await writeFile(join(repo, 'entry.cjs'), 'const revision = sharedValue() + 1;\n');
    await writeFile(join(repo, 'entry.py'), 'revision = fetch_value() + 1\n');
    await page.goto(url);
    await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
    await page.getByRole('button', { name: 'Open Comparison', exact: true }).click();
    const modifiers = [process.platform === 'darwin' ? 'Meta' : 'Control'];
    for (const { path, symbol, side, destination } of [
      { path: 'entry.cjs', symbol: 'sharedValue', side: 'after', destination: 'shared.ts' },
      { path: 'entry.py', symbol: 'fetch_value', side: 'before', destination: 'shared.pyi' },
    ]) {
      await page.getByRole('treeitem').filter({ hasText: path }).click();
      await page
        .locator(`[data-${side}-line="1"] [data-token="symbol"]`)
        .getByText(symbol, { exact: true })
        .click({ modifiers });
      await page.getByRole('heading', { name: destination, exact: true }).waitFor();
      assert.equal(await page.locator('[data-definition-target]').getAttribute(`data-${side}-line`), '1');
    }
    for (const [layout, width] of [
      ['wide', 1440],
      ['medium', 940],
      ['narrow', 390],
      ['restored-wide', 1440],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await capture(page, `python-definition-${layout}`);
    }
  });
});

test('AI note source links open tracked Git locations and reject stale revisions', { timeout: 60_000 }, async () => {
  await withWorkbench(
    async (page, url, { repo }, settings) => {
      const git = (...args) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
          cwd: repo,
          windowsHide: true,
        });
      await writeFile(join(repo, 'destination.ts'), 'export const destination = 1;\n');
      await writeFile(join(repo, 'linked.ts'), 'export const linked = true;\n');
      git('add', 'destination.ts', 'linked.ts');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'linked sources');
      await writeFile(join(repo, 'bundle.ts'), 'export const LINK_FIXTURE = true;\n');
      await writeFile(join(repo, 'destination.ts'), 'export const destination = 2;\n');
      await mkdir(settings, { recursive: true });
      await writeFile(
        join(settings, 'settings.json'),
        JSON.stringify({
          version: 1,
          appearance: 'system',
          analysis: { provider: 'desktop', model: 'fixture', guidance_topics: [] },
        }),
      );
      const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });
      const heading = (name) => page.getByRole('heading', { name, exact: true });
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
      await button('Risk Analysis').click();
      const note = button(/AI note.*See/);
      await note.click();
      await button('changed destination').waitFor();
      assert.equal(await button('invalid').count(), 0);
      assert.equal(await button('private file').count(), 0);
      await capture(page, 'ai-source-note');
      await button('changed destination').click();
      await heading('destination.ts').waitFor();
      const target = page.locator('[data-definition-target]');
      await target.filter({ hasText: 'destination = 2' }).waitFor();
      await button('Previous File Visit').click();
      await heading('bundle.ts').waitFor();
      await note.click();
      await button('tracked source').click();
      await heading('linked.ts').waitFor();
      await target.filter({ hasText: 'linked = true' }).waitFor();
      for (const [layout, width] of [
        ['wide', 1440],
        ['medium', 940],
        ['narrow', 390],
        ['restored-wide', 1440],
      ]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await capture(page, `ai-source-link-${layout}`);
      }
      await button('Previous File Visit').click();
      await heading('bundle.ts').waitFor();
      await button('Next File Visit').click();
      await heading('linked.ts').waitFor();
      await button('Previous File Visit').click();
      await heading('bundle.ts').waitFor();
      await writeFile(join(repo, 'linked.ts'), 'export const linked = false;\n');
      await note.click();
      await button('tracked source').click();
      await page.getByRole('alert').filter({ hasText: 'This source link refers to an earlier version.' }).waitFor();
    },
    { provider: true },
  );
});

test('AI settings select an approved model and keep analysis opt-in', { timeout: 60_000 }, async () => {
  await withWorkbench(
    async (page, url, { repo }, settings) => {
      const button = (name) => page.getByRole('button', { name, exact: true });
      const combo = (name) => page.getByRole('combobox', { name, exact: true });
      const option = (name) => page.getByRole('option', { name, exact: true });
      const testing = page.getByRole('checkbox', { name: 'Testing', exact: true });
      const requests = [];
      page.on('request', (request) => requests.push(new URL(request.url()).pathname));
      await page.goto(url);
      await button('AI Settings').click();
      await combo('Provider').click();
      assert.equal(await option('Unapproved Fixture').count(), 0);
      await option('Desktop Fixture').click();
      await page.getByText('Provider Data Destination', { exact: true }).waitFor();
      assert(!requests.includes('/api/v1/settings/analysis/models'));
      await button('Load Models').click();
      await combo('Model').click();
      await option('fixture').click();
      await testing.check();
      for (const width of [1440, 940, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await testing.waitFor();
        assert(await testing.isChecked());
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await capture(page, `ai-settings-${width}`);
      }
      await button('Save').click();
      await page.getByRole('dialog', { name: 'AI Settings' }).waitFor({ state: 'hidden' });
      assert.deepEqual(JSON.parse(await readFile(join(settings, 'settings.json'), 'utf8')).analysis, {
        provider: 'desktop',
        model: 'fixture',
        guidance_topics: ['testing'],
      });
      assert(!requests.includes('/api/v1/review/analysis'));

      await page.reload();
      await button('AI Settings').click();
      await combo('Model').waitFor();
      assert(await testing.isChecked());
      await button('Cancel').click();
      await page.getByRole('dialog', { name: 'AI Settings' }).waitFor({ state: 'hidden' });
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
      await button('Code Guidance').click();
      await page.getByText('Line 1 · Read the new value.', { exact: true }).waitFor();
    },
    { provider: true },
  );
});

test(
  'saved reviews restore editable discussions after restart when the file leaves the diff',
  { timeout: 60_000 },
  async () => {
    await withWorkbench(async (page, url, { repo }, _settings, restart) => {
      const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });
      const comment = page.getByRole('textbox', { name: 'Comment', exact: true });
      async function openRepository(address) {
        await page.goto(address);
        await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
        await button('Open Comparison').click();
      }
      const savedReviewDialog = page.getByRole('dialog', { name: 'Saved Reviews', exact: true });
      await openRepository(url);
      await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
      await button('Add Comment to After Line 1').click();
      await comment.fill('Keep this discussion after the file is unchanged.');
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith('/discussion') && response.request().postDataJSON().operation?.kind === 'create',
      );
      await button('Add Comment').click();
      assert((await created).ok());
      await writeFile(join(repo, 'bundle.ts'), 'export const revision = 1;\n');

      await openRepository(await restart());
      await page.getByRole('treeitem', { name: /flow\.dot/ }).waitFor();
      assert.equal(await page.getByRole('treeitem', { name: /bundle\.ts/ }).count(), 0);
      await button('Share Feedback').click();
      await page.getByRole('menuitem', { name: 'Saved Reviews…', exact: true }).click();
      await savedReviewDialog.getByRole('button', { name: /^(?!Actions for).*review-/ }).click();
      await savedReviewDialog.getByRole('button', { name: 'bundle.ts', exact: true }).waitFor();
      for (const width of [1440, 940, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await savedReviewDialog.getByRole('button', { name: 'bundle.ts', exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await capture(page, `saved-reviews-${width}`);
      }
      await savedReviewDialog.getByRole('button', { name: 'bundle.ts', exact: true }).click();
      await button(/Keep this discussion after the file is unchanged/).click();
      assert.equal(await comment.inputValue(), 'Keep this discussion after the file is unchanged.');
      await page.getByRole('status').filter({ hasText: 'This comment refers to an earlier version' }).waitFor();
      const edited = page.waitForResponse(
        (response) =>
          response.url().endsWith('/discussion') && response.request().postDataJSON().operation?.kind === 'apply',
      );
      await comment.fill('Edited after restart.');
      assert((await edited).ok());
    });
  },
);

test('HS2-42A696 saved reviews delete one confirmed review and keep the others', { timeout: 60_000 }, async () => {
  await withWorkbench(async (page, url, { repo }, settings, restart) => {
    const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });
    const feedback = join(dirname(settings), 'feedback');
    const bundles = async () => (await readdir(feedback)).filter((name) => name.startsWith('review-'));
    const dialog = page.getByRole('dialog', { name: 'Saved Reviews', exact: true });
    async function openRepository(address) {
      await page.goto(address);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
      await button('Open Comparison').click();
    }
    async function createReview(text) {
      await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
      await button('Add Comment to After Line 1').click();
      await page.getByRole('textbox', { name: 'Comment', exact: true }).fill(text);
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith('/discussion') && response.request().postDataJSON().operation?.kind === 'create',
      );
      await button('Add Comment').click();
      assert((await created).ok());
    }
    async function openSaved() {
      await button('Share Feedback').click();
      await page.getByRole('menuitem', { name: 'Saved Reviews…', exact: true }).click();
    }
    await openRepository(url);
    await createReview('First saved review.');
    await openRepository(await restart());
    await createReview('Second saved review.');
    await openRepository(await restart());
    assert.equal((await bundles()).length, 2);

    await openSaved();
    const restore = dialog.getByRole('button', { name: /^(?!Actions for).*review-/ });
    const actions = dialog.getByRole('button', { name: /^Actions for review-/ });
    const confirmation = page.getByRole('alertdialog', { name: 'Delete Saved Review?', exact: true });
    await restore.first().waitFor();
    assert.equal(await restore.count(), 2);
    assert.equal(await actions.count(), 2, 'each review has its own overflow menu');
    await capture(page, 'saved-reviews-delete-list');

    // Delete… in a review's menu asks first; Cancel keeps both reviews.
    await actions.first().click();
    await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
    await confirmation.waitFor();
    for (const width of [1440, 940, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await capture(page, `saved-reviews-delete-confirm-${width}`);
    }
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await confirmation.waitFor({ state: 'hidden' });
    assert.equal(await restore.count(), 2);
    assert.equal((await bundles()).length, 2);

    // Confirming removes exactly that review.
    await actions.first().click();
    await page.getByRole('menuitem', { name: 'Delete…', exact: true }).click();
    const removed = page.waitForResponse((response) => response.url().endsWith('/saved/delete'));
    await confirmation.getByRole('button', { name: 'Delete Review', exact: true }).click();
    assert((await removed).ok());
    await confirmation.waitFor({ state: 'hidden' });
    await actions.first().waitFor();
    assert.equal(await actions.count(), 1);
    assert.equal((await bundles()).length, 1);
    await capture(page, 'saved-reviews-delete-after');

    // The remaining review still opens, and an open review offers no delete.
    await restore.click();
    await dialog.getByText('This comparison has an open review.').waitFor();
    assert.equal(await actions.count(), 0);
    assert.equal((await bundles()).length, 1);
  });
});

test(
  'HS2-Q3X4BX image comparison keeps its mode across files and falls back clearly when unsupported',
  { timeout: 60_000 },
  async () => {
    await withWorkbench(async (page, url, _paths, settings) => {
      const media = join(dirname(settings), 'Media');
      await mkdir(media);
      const git = (...args) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
          cwd: media,
          windowsHide: true,
        });
      git('init', '-q', '--initial-branch=review');
      for (const name of ['a.svg', 'c.svg']) await writeFile(join(media, name), svg('#506b91'));
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
      for (const name of ['a.svg', 'b.svg', 'c.svg']) await writeFile(join(media, name), svg('#3b7c68'));
      git('add', 'b.svg');

      const button = (name) => page.getByRole('button', { name, exact: true });
      const mode = async (name) => (await button(name).getAttribute('aria-pressed')) === 'true';
      const notice = page.getByRole('status').filter({ hasText: 'is not available for this image' });
      const open = (name) => page.getByRole('treeitem', { name: new RegExp(`${name}`) }).click();
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(media);
      await button('Open Comparison').click();

      await open('a\\.svg');
      await button('Over and Under').click();
      assert(await mode('Over and Under'));
      await open('c\\.svg');
      await button('Over and Under').waitFor();
      assert(await mode('Over and Under'), 'a supported pair keeps the chosen orientation');
      assert.equal(await notice.count(), 0);

      await open('b\\.svg');
      await notice.waitFor();
      assert.equal(await button('Over and Under').count(), 0, 'an added image cannot be stacked');
      assert(await mode('Side by Side'), 'unsupported modes fall back to Side by Side');
      await capture(page, 'media-mode-fallback');

      await open('c\\.svg');
      await button('Over and Under').waitFor();
      assert(await mode('Over and Under'), 'the choice returns when the next pair supports it');
      assert.equal(await notice.count(), 0, 'the fallback notice is cleared');
      await button('Before Image').click();
      await open('b\\.svg');
      await notice.waitFor();
      assert(await mode('Side by Side'));
      await button('After Image').click();
      assert.equal(await notice.count(), 0, 'choosing a mode clears the notice');
      await open('a\\.svg');
      await button('Before Image').waitFor();
      assert(await mode('After Image'), 'the last explicit choice follows to the next file');
    });
  },
);

test('built workbench opens a Git difftool snapshot with relative clipboard only', { timeout: 60_000 }, async () => {
  await withWorkbench(
    async (page, url) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
      await page.goto(url);
      await page.getByRole('heading', { name: 'after.txt', exact: true }).waitFor();
      await page.locator('.text-diff').getByText('after', { exact: true }).waitFor();
      const button = (name) => page.getByRole('button', { name, exact: true });
      for (const action of ['Copy Absolute Path', 'Reveal in File Manager', 'Open in Default Editor']) {
        assert(await button(action).isDisabled(), action);
      }
      await button('Copy Relative Path').click();
      await page.getByRole('status').filter({ hasText: 'Relative path copied.' }).waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'after.txt');
      await capture(page, 'workbench-difftool');
    },
    { launchArgs: ({ before, after }) => ['--difftool', before, after] },
  );
});

test('diagram source toggle keeps adjacent review modes unchanged', { timeout: 60_000 }, async () => {
  await withWorkbench(
    async (page, url, paths) => {
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(paths.repo);
      await page.getByRole('button', { name: 'Open Comparison', exact: true }).click();
      await page.getByRole('treeitem', { name: /flow\.dot/ }).click();
      await page.getByRole('button', { name: 'Render Diagram', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('img[data-media-side="after"]')?.naturalWidth > 0);
      assert.equal(await page.evaluate(() => Reflect.has(window, 'diagramScriptRan')), false);
      await page.getByRole('button', { name: 'Show Diagram Source', exact: true }).click();
      assert.equal(
        await page.getByRole('button', { name: 'Risk Analysis', exact: true }).getAttribute('aria-pressed'),
        'false',
      );
      assert.equal(
        await page.getByRole('button', { name: 'Code Guidance', exact: true }).getAttribute('aria-pressed'),
        'false',
      );
      await page.locator('.text-diff').waitFor();
    },
    { renderer: true },
  );
});

test(
  'changed-file history restores scroll and discards forward visits when branching',
  { timeout: 60_000 },
  async () => {
    await withWorkbench(async (page, url, paths) => {
      const button = (name) => page.getByRole('button', { name, exact: true });
      const select = (name) => page.getByRole('treeitem', { name }).click();
      const paneSelector = '[data-workbench-main][aria-label="Comparison"] .text-diff';
      const scroller = page.locator(paneSelector);
      const longContent = page.locator('.text-diff').getByText('new 0', { exact: true });
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(paths.repo);
      await button('Open Comparison').click();
      await select(/long\.txt/);
      await longContent.waitFor();
      assert(await button('Previous File Visit').isDisabled());
      // HS2-533A50: the comparison scroll slot is the Workbench's public `mainPane.contentClassName`.
      const slot = page.locator('[data-workbench-main][aria-label="Comparison"] .review-comparison-scroll');
      assert.equal(await slot.count(), 1);
      assert.equal(await slot.locator('.text-diff').count(), 1);
      const previousTop = await scroller.evaluate(async (element) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        element.scrollTo({ top: 420, behavior: 'instant' });
        return element.scrollTop;
      });
      assert(previousTop > 300, `The comparison should scroll. Actual offset ${previousTop}`);
      await select(/bundle\.ts/);
      await page.getByRole('heading', { name: 'bundle.ts', exact: true }).waitFor();
      await button('Previous File Visit').click();
      await longContent.waitFor();
      await page.waitForFunction(({ selector, top }) => document.querySelector(selector)?.scrollTop === top, {
        selector: paneSelector,
        top: previousTop,
      });
      await page.keyboard.press('Alt+ArrowRight');
      await page.getByRole('heading', { name: 'bundle.ts', exact: true }).waitFor();
      await page.keyboard.press('Alt+ArrowLeft');
      await longContent.waitFor();
      await select(/flow\.dot/);
      assert(await button('Next File Visit').isDisabled());
      await button('Inline').waitFor();
      for (const width of [1440, 940, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await button('Previous File Visit').waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await capture(page, `history-${width}`);
      }
      // HS2-533A50: without a text diff the Workbench's public slot is the scroll container itself.
      await page.setViewportSize({ width: 1440, height: 260 });
      await select(/mark\.svg/);
      await page.getByRole('heading', { name: 'mark.svg', exact: true }).waitFor();
      const slotTop = await slot.evaluate(async (element) => {
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        element.scrollTo({ top: 60, behavior: 'instant' });
        return element.scrollTop;
      });
      assert(slotTop > 0, `The comparison slot should scroll. Actual offset ${slotTop}`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await button('Change Source').click();
      await button('Open Comparison').click();
      await page.getByRole('heading', { name: 'Review', exact: true }).waitFor();
      assert(await button('Previous File Visit').isDisabled());
    });
  },
);

// GB2-806ABB: the Feedback Storage and Send to Hot Sheet dialogs are Kerf DialogSurface dialogs.
test(
  'Feedback Storage lists usage, confirms each cleanup scope and keeps open bundles',
  { timeout: 60_000 },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const button = (name) => page.getByRole('button', { name, exact: true });
      const dialog = page.getByRole('dialog', { name: 'Feedback Storage' });
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
      await button('Add Comment to After Line 1').focus();
      await page.keyboard.press('Enter');
      const inspector = page.getByRole('region', { name: 'Discussion' });
      await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill('Storage check.');
      const created = page.waitForResponse(
        (response) =>
          response.url().endsWith('/discussion') && response.request().postDataJSON().operation?.kind === 'create',
      );
      await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
      assert((await created).ok());

      await button('Feedback Storage').click();
      await dialog.getByText('Saved Feedback', { exact: true }).waitFor();
      await dialog.getByText('By Project', { exact: true }).waitFor();
      assert.equal(await dialog.getByText(/^\d+(\.\d+)? \w+ · 1 bundle$/).count(), 2);
      for (const width of [1440, 940, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await dialog.getByText('Bundles stay on disk until you clear them.').waitFor();
        await assertDialogInset(dialog, 'Saved Feedback');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await capture(page, `storage-${width}`);
      }
      await dialog.getByRole('button', { name: /^Clear Fieldnotes/ }).click();
      await dialog.getByText('Clear Saved Project Feedback?', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await dialog.getByText('Saved Feedback', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Clear All', exact: true }).click();
      await dialog.getByText('Clear All Saved Feedback?', { exact: true }).waitFor();
      await capture(page, 'storage-confirm');
      await dialog.getByRole('button', { name: 'Clear Saved Feedback', exact: true }).click();
      await dialog.getByText('Open Bundles Kept', { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
      await dialog.waitFor({ state: 'hidden' });
    });
  },
);

test('Send to Hot Sheet 2 opens as one dialog with its sections and closes', { timeout: 60_000 }, async () => {
  await withWorkbench(async (page, url, { repo }) => {
    const button = (name) => page.getByRole('button', { name, exact: true });
    const dialog = page.getByRole('dialog', { name: 'Send to Hot Sheet 2' });
    await page.goto(url);
    await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(repo);
    await button('Open Comparison').click();
    await page.getByRole('treeitem', { name: /bundle\.ts/ }).click();
    await button('Share Feedback').click();
    await page.getByRole('menuitem', { name: /Send to Hot Sheet 2/ }).click();
    for (const heading of ['Hot Sheet Project', 'Ticket', 'Review', 'Included Feedback']) {
      await dialog.getByText(heading, { exact: true }).waitFor();
    }
    await dialog.getByRole('textbox', { name: 'Title', exact: true }).waitFor();
    for (const width of [1440, 940, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
      await assertDialogInset(dialog, 'Hot Sheet Project');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await capture(page, `export-${width}`);
    }
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
  });
});
