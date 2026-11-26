import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
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

async function withWorkbench(
  exercise,
  { launchArgs = () => [], renderer = false, provider = false, environment = () => ({}) } = {},
) {
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
          GLASSBOX_GRAPHVIZ_EXECUTABLE: '',
          GLASSBOX_MERMAID_EXECUTABLE: '',
          GLASSBOX_JAVA_EXECUTABLE: '',
          GLASSBOX_PLANTUML_JAR: '',
          GLASSBOX_AI_PROVIDER_DIRECTORY: provider ? providerHome : '',
          GLASSBOX_AI_PROVIDER: '',
          GLASSBOX_AI_TRUSTED_PROVIDERS: provider ? 'desktop' : '',
          ...environment({ scratch }),
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

// HS2-DZ8ZR6: reveal unchanged lines around hunks and toward the file's ends, against a real host and repository.
test(
  'HS2-DZ8ZR6 reveals unchanged context repeatedly in both layouts and refuses a changed source',
  {
    timeout: 90_000,
  },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const context = join(dirname(repo), 'Context');
      await mkdir(context);
      const git = (...args) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
          cwd: context,
          windowsHide: true,
        });
      const lines = (change = {}) =>
        Array.from({ length: 120 }, (_, index) => change[index + 1] ?? `line ${index + 1}`).join('\n') + '\n';
      git('init', '-q', '--initial-branch=review');
      await writeFile(join(context, 'ctx.txt'), lines());
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
      await writeFile(join(context, 'ctx.txt'), lines({ 30: 'changed 30', 90: 'changed 90' }));

      const button = (name) => page.getByRole('button', { name, exact: true });
      const cell = (line) => page.locator(`.text-diff__cell[data-after-line="${line}"]`).first();
      const controls = (gap) => page.locator(`.context-expander[data-gap="${gap}"]`);
      const reveal = async (gap, label, first, last) => {
        const response = page.waitForResponse((reply) => reply.url().endsWith('/api/v1/review/context'));
        await controls(gap).getByRole('button', { name: label, exact: true }).click();
        assert((await response).ok());
        await cell(first).waitFor();
        await cell(last).waitFor();
      };
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(context);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /ctx\.txt/ }).click();
      await button('Inline').click();
      await page.locator('.text-diff__cell[data-after-line="30"]').waitFor();

      // Head, middle and tail each start collapsed; the first line of the file is not shown.
      assert.equal(await page.locator('.context-expander').count(), 3);
      assert.equal(await cell(1).count(), 0);
      assert.equal(await page.locator('.text-diff__range').count(), 2);
      assert.deepEqual(await controls(1).getByRole('button').allTextContents(), [
        'Show 20 Above',
        'Show 20 Below',
        'Show All 53',
      ]);
      assert.equal(await controls(0).getByRole('button', { name: 'Show 20 Below' }).count(), 0);
      assert.equal(await controls(2).getByRole('button', { name: 'Show 20 Above' }).count(), 0);

      // Repeated expansion grows from the previous change; the lines it adds are numbered on both sides.
      await reveal(1, 'Show 20 Below', 34, 53);
      assert.equal(await cell(54).count(), 0);
      await reveal(1, 'Show 20 Below', 54, 73);
      assert.deepEqual(await controls(1).getByRole('button').allTextContents(), ['Show 13 Lines']);
      assert.equal(await page.locator('[data-after-line="34"][data-before-line="34"]').count(), 1);
      // Revealed lines take comments like the diff's own lines, and the thread shows under its line (GB2-5QQPPW).
      assert.equal(await page.getByRole('button', { name: 'Add Comment to After Line 30' }).count(), 1);
      const inspector = page.getByRole('region', { name: 'Discussion' });
      await button('Add Comment to After Line 34').click();
      await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill('On a revealed line.');
      const created = page.waitForResponse(
        (reply) => reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.kind === 'create',
      );
      await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
      assert((await created).ok());
      const revealedThread = page.locator('.text-diff .discussion-inline__thread');
      await revealedThread.first().waitFor();
      assert.equal(
        await revealedThread
          .first()
          .evaluate((element) => element.closest('.discussion-inline').previousElementSibling.dataset.afterLine),
        '34',
      );

      // Closing the last hidden lines merges the hunks: no control and no header between them.
      await reveal(1, 'Show 13 Lines', 74, 86);
      assert.equal(await controls(1).count(), 0);
      assert.equal(await page.locator('.text-diff__range').count(), 1);

      // The ends of the file: above the first change and below the last.
      await reveal(0, 'Show 20 Above', 7, 26);
      assert.equal(await cell(6).count(), 0);
      await controls(0).getByRole('button', { name: 'Show 6 Lines' }).click();
      await cell(1).waitFor();
      assert.equal(await controls(0).count(), 0);
      await reveal(2, 'Show All 27', 94, 120);
      assert.equal(await page.locator('.context-expander').count(), 0);
      assert.equal(await page.locator('.text-diff__range').count(), 0);
      await capture(page, 'context-inline-1440');

      // Side by side shows the same revealed rows on both sides; narrow widths keep the page from scrolling sideways.
      await button('Side by Side').click();
      assert.equal(await page.locator('.text-diff__cell[data-side="before"][data-before-line="60"]').count(), 1);
      assert.equal(await page.locator('.text-diff__cell[data-side="after"][data-after-line="60"]').count(), 1);
      for (const width of [940, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await cell(60).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await capture(page, `context-split-${width}`);
      }

      // A source that changed after the file opened is refused without disturbing what is shown.
      await page.reload();
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(context);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /ctx\.txt/ }).click();
      await page.locator('.text-diff__cell[data-after-line="30"]').first().waitFor();
      await reveal(1, 'Show 20 Below', 34, 53);
      await capture(page, 'context-partial-1440');
      await writeFile(join(context, 'ctx.txt'), lines({ 5: 'edited 5', 30: 'changed 30', 90: 'changed 90' }));
      const refused = page.waitForResponse((reply) => reply.url().endsWith('/api/v1/review/context'));
      await controls(1).getByRole('button', { name: 'Show 20 Above', exact: true }).click();
      assert.equal((await refused).status(), 409);
      await page.getByText('Could Not Show Lines', { exact: true }).waitFor();
      await page.getByText(/changed after it was opened/u).waitFor();
      await cell(53).waitFor();
      assert.equal(await cell(67).count(), 0, 'the refused lines never join the stale diff');
      await capture(page, 'context-refused-1440');
    });
  },
);

// HS2-30ZEFE: Find within the lines the diff shows, against a real host and repository.
test('HS2-30ZEFE finds, steps and clears matches across layouts, context and files', { timeout: 90_000 }, async () => {
  await withWorkbench(async (page, url, { repo }) => {
    const folder = join(dirname(repo), 'Finder');
    await mkdir(folder);
    const git = (...args) =>
      execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
        cwd: folder,
        windowsHide: true,
      });
    const lines = (change = {}) =>
      Array.from({ length: 120 }, (_, index) => change[index + 1] ?? `line ${index + 1}`).join('\n') + '\n';
    const shared = { 32: 'a Needle in context', 60: 'hidden needle 60' };
    git('init', '-q', '--initial-branch=review');
    await writeFile(join(folder, 'find.txt'), lines(shared));
    await writeFile(join(folder, 'other.txt'), 'one\ntwo\nthree\n');
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
    await writeFile(join(folder, 'find.txt'), lines({ ...shared, 30: 'changed needle 30', 90: 'changed NEEDLE 90' }));
    await writeFile(join(folder, 'other.txt'), 'one\nneedle other\nthree\n');

    const button = (name) => page.getByRole('button', { name, exact: true });
    const marks = page.locator('.text-diff mark[data-find]');
    const current = page.locator('.text-diff mark[data-find="current"]');
    const field = page.getByRole('searchbox', { name: 'Find in Diff' });
    // The readout can also sit in a polite live region, so wait for a visible element with exactly this text.
    const readout = (text) => ({
      waitFor: () =>
        page.waitForFunction(
          ({ source, flags }) => {
            const pattern = new RegExp(source, flags);
            return [...document.querySelectorAll('*')].some(
              (element) =>
                element.children.length === 0 &&
                pattern.test(element.textContent?.trim() ?? '') &&
                element.checkVisibility(),
            );
          },
          text instanceof RegExp
            ? { source: text.source, flags: text.flags }
            : { source: `^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, flags: '' },
        ),
    });
    const currentLine = () =>
      current.first().evaluate((mark) => mark.closest('.text-diff__cell').getAttribute('data-after-line'));
    await page.goto(url);
    await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(folder);
    await button('Open Comparison').click();
    await page.getByRole('treeitem', { name: /find\.txt/ }).click();
    await button('Inline').click();
    await page.locator('.text-diff__cell[data-after-line="30"]').waitFor();

    // Nothing is marked or counted before a search; the previous and next buttons stay but cannot act.
    assert.equal(await marks.count(), 0);
    assert.equal(await button('Next Match').isDisabled(), true);

    // Ctrl+F opens the field with focus in it; the matches ignore case and cover the lines shown.
    await page.keyboard.press('Control+f');
    await field.waitFor();
    await page.keyboard.type('needle');
    await readout('1 of 3').waitFor();
    assert.equal(await marks.count(), 3);
    assert.equal(await current.count(), 1);
    assert.equal(await currentLine(), '30');
    await capture(page, 'find-inline-1440');
    await page.emulateMedia({ colorScheme: 'dark' });
    await capture(page, 'find-inline-dark-1440');
    await page.emulateMedia({ colorScheme: 'light' });

    // Enter and Shift+Enter step forward and back, wrapping at both ends; the buttons do the same.
    await page.keyboard.press('Enter');
    await readout('2 of 3').waitFor();
    assert.equal(await currentLine(), '32');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await readout('1 of 3').waitFor();
    await page.keyboard.press('Shift+Enter');
    await readout('3 of 3').waitFor();
    assert.equal(await currentLine(), '90');
    await button('Previous Match').click();
    await readout('2 of 3').waitFor();
    await button('Next Match').click();
    await readout('3 of 3').waitFor();

    // Stepping scrolls the diff to the match.
    const visible = () =>
      current.first().evaluate((mark) => {
        const box = mark.getBoundingClientRect();
        return box.top >= 0 && box.bottom <= window.innerHeight;
      });
    assert(await visible());

    // Lines the diff hides are not searched until they are revealed, and revealing keeps the position.
    await page
      .locator('.context-expander[data-gap="1"]')
      .getByRole('button', { name: 'Show All 53', exact: true })
      .click();
    await readout('3 of 4').waitFor();
    assert.equal(await marks.count(), 4);

    // The split layout shows a context line on both sides, marked on each, and counts it once.
    await button('Side by Side').click();
    await page.locator('.text-diff[data-layout="split"] mark[data-find]').first().waitFor();
    // Context lines 32 and 60 are marked on both sides; added lines 30 and 90 on one.
    assert.equal(await marks.count(), 6);
    await readout('3 of 4').waitFor();
    for (const width of [940, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await field.waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      await capture(page, `find-split-${width}`);
    }

    // Another file keeps the query and starts at its first match.
    await page.getByRole('treeitem', { name: /other\.txt/ }).click();
    await readout('1 of 1').waitFor();
    assert.equal(await marks.count(), 1);
    await page.getByRole('treeitem', { name: /find\.txt/ }).click();
    await readout('1 of 3').waitFor();

    // A query with no matches says so, marks nothing and disables stepping.
    await field.fill('zzzz');
    await readout('No matches').waitFor();
    assert.equal(await marks.count(), 0);
    assert.equal(await button('Next Match').isDisabled(), true);
    await capture(page, 'find-none-1440');

    // Escape clears the query, the marks and the readout; the field stays for another search.
    await field.fill('line 3');
    await readout(/^\d+ of \d+$/).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelectorAll('.text-diff mark[data-find]').length === 0);
    assert.equal(await field.evaluate((element) => element.textContent?.trim()), '');
    assert.equal(await button('Next Match').isDisabled(), true);
  });
});

// HS2-FTEQVQ: per-file review progress, persisted by the host with the comparison and rechecked against the file.
test(
  'HS2-FTEQVQ marks files reviewed, keeps them across reopening and drops a mark when the file changes',
  {
    timeout: 90_000,
  },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const folder = join(dirname(repo), 'Progress');
      await mkdir(folder);
      const git = (...args) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
          cwd: folder,
          windowsHide: true,
        });
      git('init', '-q', '--initial-branch=review');
      await writeFile(join(folder, 'a.txt'), 'one\n');
      await writeFile(join(folder, 'b.txt'), 'two\n');
      await writeFile(join(folder, 'c.txt'), 'three\n');
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
      await writeFile(join(folder, 'a.txt'), 'one changed\n');
      await writeFile(join(folder, 'b.txt'), 'two changed\n');

      const button = (name) => page.getByRole('button', { name, exact: true });
      const mark = button('Mark Reviewed');
      const bar = page.getByRole('progressbar', { name: 'Files Reviewed' });
      const row = (name) => page.getByRole('treeitem', { name });
      const open = async () => {
        await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(folder);
        await button('Open Comparison').click();
        await row(/a\.txt/).waitFor();
      };
      const summary = async () =>
        (await page.locator('.review-navigator').innerText()).match(/Files Reviewed\s+(\d+ of \d+)/u)?.[1];
      const pressed = async () => mark.getAttribute('aria-pressed');
      const saved = () => page.waitForResponse((reply) => reply.url().endsWith('/api/v1/review/progress/mark'));
      await page.goto(url);
      await open();

      // Nothing is reviewed at first; the mark button needs a loaded file.
      await bar.waitFor();
      assert.equal(await summary(), '0 of 2');
      await row(/a\.txt/).click();
      await page.locator('.text-diff').waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-action="review-progress-toggle"]')?.disabled);
      assert.equal(await pressed(), 'false');

      // Marking a file shows it on its row and in the count.
      const marking = saved();
      await mark.click();
      assert((await marking).ok());
      await page.waitForFunction(
        () => document.querySelector('[data-action="review-progress-toggle"]')?.ariaPressed === 'true',
      );
      assert.equal(await summary(), '1 of 2');
      assert.equal(await bar.getAttribute('value'), '1');
      assert.equal(await bar.getAttribute('max'), '2');
      assert.equal(
        await row(/a\.txt/)
          .locator('[title="Reviewed"]')
          .count(),
        1,
      );
      assert.equal(
        await row(/b\.txt/)
          .locator('[title="Reviewed"]')
          .count(),
        0,
      );
      await capture(page, 'progress-reviewed-1440');

      // Reopening keeps the mark with the comparison.
      await page.reload();
      await open();
      await bar.waitFor();
      await page.waitForFunction(() => /Files Reviewed\s+1 of 2/u.test(document.body.innerText));
      assert.equal(
        await row(/a\.txt/)
          .locator('[title="Reviewed"]')
          .count(),
        1,
      );

      // A file that changed after it was marked is no longer counted and says so.
      await writeFile(join(folder, 'a.txt'), 'one changed again\n');
      await page.reload();
      await open();
      await row(/a\.txt/)
        .locator('[title="Changed Since Reviewed"]')
        .waitFor();
      assert.equal(await summary(), '0 of 2');
      assert.equal(
        await row(/a\.txt/)
          .locator('[title="Changed Since Reviewed"]')
          .count(),
        1,
      );
      assert.equal(
        await row(/a\.txt/)
          .locator('[title="Reviewed"]')
          .count(),
        0,
      );
      await row(/a\.txt/).click();
      await page.locator('.text-diff').waitFor();
      await page.waitForFunction(() => !document.querySelector('[data-action="review-progress-toggle"]')?.disabled);
      assert.equal(await pressed(), 'false', 'the changed file is not shown as reviewed');
      await capture(page, 'progress-changed-1440');

      // Reviewing the new content marks it again; pressing again clears it.
      const again = saved();
      await mark.click();
      assert((await again).ok());
      await page.waitForFunction(() => /Files Reviewed\s+1 of 2/u.test(document.body.innerText));
      assert.equal(
        await row(/a\.txt/)
          .locator('[title="Reviewed"]')
          .count(),
        1,
      );
      const clearing = saved();
      await mark.click();
      assert((await clearing).ok());
      await page.waitForFunction(() => /Files Reviewed\s+0 of 2/u.test(document.body.innerText));
      assert.equal(await pressed(), 'false');

      // Another comparison of the same repository starts with its own, empty progress.
      const marked = saved();
      await mark.click();
      assert((await marked).ok());
      await page.waitForFunction(() => /Files Reviewed\s+1 of 2/u.test(document.body.innerText));
      await button('Change Source').click();
      await page.getByRole('combobox', { name: 'Git Changes' }).click();
      await page.getByRole('option', { name: /Staged/ }).click();
      await button('Open Comparison').click();
      await page.getByText('No Changed Files', { exact: true }).waitFor();
      assert.equal(await bar.count(), 0, 'no progress is shown for a comparison without files');

      // The narrow layout keeps the control and the count reachable.
      await page.reload();
      await open();
      for (const width of [940, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        // A narrow workbench keeps Changed Files in an overlay; open it to see the progress and the row marks.
        const railState = (open) =>
          page.waitForFunction((expected) => {
            const rail = document.querySelector('[aria-label="Changed Files"]');
            const shown = rail !== null && !rail.inert && rail.getAttribute('aria-hidden') !== 'true';
            return shown === expected;
          }, open);
        if (width < 600) {
          await railState(false);
          await button('Show Files').first().click();
        }
        await railState(true);
        await bar.waitFor();
        await row(/a\.txt/)
          .locator('[title="Reviewed"]')
          .waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await capture(page, `progress-${width}`);
      }
    });
  },
);

// HS2-TGAGQ4: a line comment moves to another line or side, validated by the host, and cancelling changes nothing.
test(
  'HS2-TGAGQ4 moves a comment thread to another line or side and refuses a destination that is not shown',
  {
    timeout: 90_000,
  },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const folder = join(dirname(repo), 'Mover');
      await mkdir(folder);
      const git = (...args) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
          cwd: folder,
          windowsHide: true,
        });
      const lines = (change = {}) =>
        Array.from({ length: 12 }, (_, index) => change[index + 1] ?? `line ${index + 1}`).join('\n') + '\n';
      git('init', '-q', '--initial-branch=review');
      await writeFile(join(folder, 'm.txt'), lines());
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
      await writeFile(join(folder, 'm.txt'), lines({ 3: 'changed 3', 9: 'changed 9' }));

      const button = (name) => page.getByRole('button', { name, exact: true });
      const inspector = page.getByRole('region', { name: 'Discussion' });
      const thread = page.locator('.text-diff .discussion-inline__thread');
      // The row of the diff that holds the inline thread, as its after-side line number.
      const rowOf = () =>
        thread
          .first()
          .evaluate((element) => element.closest('.discussion-inline').previousElementSibling.dataset.afterLine);
      const submit = () =>
        page.waitForResponse(
          (reply) => reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.kind === 'move',
        );
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(folder);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /m\.txt/ }).click();
      await page.locator('.text-diff__cell[data-after-line="3"]').first().waitFor();

      // A comment on after line 3 with a reply, so the move has something to keep.
      await button('Add Comment to After Line 3').click();
      await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill('Check the new wording.');
      const created = page.waitForResponse(
        (reply) => reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.kind === 'create',
      );
      await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
      assert((await created).ok());
      await thread.first().waitFor();
      await inspector.getByRole('textbox', { name: 'Reply', exact: true }).fill('Reworded.');
      const replied = page.waitForResponse(
        (reply) =>
          reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.change?.kind === 'reply',
      );
      await inspector.getByRole('button', { name: 'Post Reply', exact: true }).click();
      assert((await replied).ok());
      await page.getByText('1 reply', { exact: true }).waitFor();
      assert.equal(await rowOf(), '3');

      // Cancel leaves the thread where it was.
      await inspector.getByRole('button', { name: 'Move Comment', exact: true }).click();
      const line = inspector.getByRole('spinbutton', { name: 'Move to Line' });
      assert.equal(await line.inputValue(), '3');
      await line.fill('5');
      await inspector.getByRole('button', { name: 'Cancel', exact: true }).click();
      await inspector.getByRole('button', { name: 'Move Comment', exact: true }).waitFor();
      assert.equal(await rowOf(), '3');

      // A line the diff does not show is refused by the host and the form stays for another try.
      await inspector.getByRole('button', { name: 'Move Comment', exact: true }).click();
      await line.fill('99');
      const refused = submit();
      await inspector.getByRole('button', { name: 'Move', exact: true }).click();
      assert.equal((await refused).status(), 409);
      await inspector.getByRole('alert').filter({ hasText: 'has changed' }).waitFor();
      assert.equal(await rowOf(), '3');
      assert.equal(await line.inputValue(), '99');
      await capture(page, 'move-refused-1440');

      // The keyboard moves it: Enter in the line field submits.
      await line.fill('5');
      const moving = submit();
      await line.press('Enter');
      assert((await moving).ok());
      await page.waitForFunction(
        () =>
          document.querySelector('.text-diff .discussion-inline')?.previousElementSibling?.dataset.afterLine === '5',
      );
      assert.equal(await rowOf(), '5');
      await page.getByText('1 reply', { exact: true }).waitFor();
      assert.equal(
        await inspector.getByRole('spinbutton', { name: 'Move to Line' }).count(),
        0,
        'the form closes once saved',
      );
      assert.equal(
        await inspector.getByRole('textbox', { name: 'Reply Author' }).inputValue(),
        'You',
        'the closed form leaves the reply fields alone',
      );
      await capture(page, 'move-done-1440');

      // Another side: the removed line only exists before the change.
      await inspector.getByRole('button', { name: 'Move Comment', exact: true }).click();
      await inspector.getByRole('combobox', { name: 'Move to Side' }).click();
      await page.getByRole('option', { name: 'Before', exact: true }).click();
      await line.fill('3');
      const sideMove = submit();
      await inspector.getByRole('button', { name: 'Move', exact: true }).click();
      assert((await sideMove).ok());
      await page.waitForFunction(
        () =>
          document.querySelector('.text-diff .discussion-inline')?.previousElementSibling?.dataset.afterLine === '3',
      );
      assert.match(await inspector.innerText(), /Before line 3/u);

      // The move survives a reload, replies included.
      await page.reload();
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(folder);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /m\.txt/ }).click();
      await thread.first().waitFor();
      await thread.first().click();
      await page.getByText('1 reply', { exact: true }).first().waitFor();
      assert.match(await inspector.innerText(), /Before line 3/u);

      // Narrow widths keep the form reachable without sideways scrolling.
      await inspector.getByRole('button', { name: 'Move Comment', exact: true }).click();
      for (const width of [940, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        await capture(page, `move-${width}`);
      }
    });
  },
);

// HS2-RV5BD8: a stale line comment is offered a new line only for one shown match, and only on confirmation.
test(
  'HS2-RV5BD8 suggests a new line for a stale comment and keeps ambiguous or missing ones stale',
  {
    timeout: 90_000,
  },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const folder = join(dirname(repo), 'Relocator');
      await mkdir(folder);
      const git = (...args) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
          cwd: folder,
          windowsHide: true,
        });
      const write = (lines) => writeFile(join(folder, 'r.txt'), lines.join('\n') + '\n');
      git('init', '-q', '--initial-branch=review');
      await write(['one', 'two', 'needle line', 'four', 'five', 'six', 'seven', 'eight']);
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
      await write(['one', 'two', 'needle line', 'four', 'five', 'SIX', 'seven', 'eight']);

      const button = (name) => page.getByRole('button', { name, exact: true });
      const thread = page.locator('.text-diff .discussion-inline__thread');
      const inspector = page.getByRole('region', { name: 'Discussion' });
      const open = async () => {
        await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(folder);
        await button('Open Comparison').click();
        await page.getByRole('treeitem', { name: /r\.txt/ }).click();
        await page.locator('.text-diff').waitFor();
      };
      const rowOf = () =>
        thread
          .first()
          .evaluate((element) => element.closest('.discussion-inline').previousElementSibling.dataset.afterLine);
      const openStale = async () => {
        await page
          .getByRole('region', { name: 'Stale Discussions' })
          .locator('.discussion-inline__thread')
          .first()
          .click();
        await inspector.getByText('refers to an earlier version').waitFor();
      };
      await page.goto(url);
      await open();
      await page.locator('.text-diff__cell[data-after-line="3"]').first().waitFor();
      await button('Add Comment to After Line 3').click();
      await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill('Rename this.');
      const created = page.waitForResponse(
        (reply) => reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.kind === 'create',
      );
      await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
      assert((await created).ok());
      await thread.first().waitFor();
      assert.equal(await rowOf(), '3');

      // More than one line now matches, so nothing is offered and the comment stays stale.
      await write(['one', 'needle line', 'two', 'needle line', 'four', 'five', 'SIX', 'eight']);
      await page.reload();
      await open();
      await openStale();
      await inspector.getByRole('button', { name: 'Suggest New Line', exact: true }).click();
      await inspector.getByText('More than one line matches').waitFor();
      assert.equal(await inspector.getByRole('button', { name: 'Move Here', exact: true }).count(), 0);
      await capture(page, 'relocate-ambiguous-1440');
      await inspector.getByRole('button', { name: 'Dismiss', exact: true }).click();
      await inspector.getByRole('button', { name: 'Suggest New Line', exact: true }).waitFor();

      // No line reads the same any more, so again nothing is offered.
      await write(['one', 'two', 'needle lines', 'four', 'five', 'SIX', 'seven', 'eight']);
      await page.reload();
      await open();
      await openStale();
      await inspector.getByRole('button', { name: 'Suggest New Line', exact: true }).click();
      await inspector.getByText('No line matches the commented text').waitFor();
      assert.equal(await inspector.getByRole('button', { name: 'Move Here', exact: true }).count(), 0);

      // One shown match is offered; Dismiss leaves everything as it was.
      await write(['one', 'two', 'four', 'five', 'needle line', 'SIX', 'seven', 'eight']);
      await page.reload();
      await open();
      await openStale();
      await inspector.getByRole('button', { name: 'Suggest New Line', exact: true }).click();
      await inspector.getByText('now at After line 5').waitFor();
      await capture(page, 'relocate-suggestion-1440');
      await inspector.getByRole('button', { name: 'Dismiss', exact: true }).click();
      await inspector.getByText('refers to an earlier version').waitFor();

      // The file changes again before the person confirms: the host refuses and the comment stays stale.
      await inspector.getByRole('button', { name: 'Suggest New Line', exact: true }).click();
      await inspector.getByText('now at After line 5').waitFor();
      await write(['one', 'two', 'four', 'five', 'other text', 'SIX', 'seven', 'eight']);
      const refused = page.waitForResponse(
        (reply) => reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.kind === 'move',
      );
      await inspector.getByRole('button', { name: 'Move Here', exact: true }).click();
      assert.equal((await refused).status(), 409);
      await inspector.getByRole('alert').waitFor();
      await inspector.getByText('refers to an earlier version').waitFor();

      // Confirming a fresh suggestion moves the comment onto the current version.
      await write(['one', 'two', 'four', 'five', 'needle line', 'SIX', 'seven', 'eight']);
      await page.reload();
      await open();
      await openStale();
      await inspector.getByRole('button', { name: 'Suggest New Line', exact: true }).click();
      await inspector.getByText('now at After line 5').waitFor();
      const moved = page.waitForResponse(
        (reply) => reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.kind === 'move',
      );
      await inspector.getByRole('button', { name: 'Move Here', exact: true }).click();
      assert((await moved).ok());
      await page.waitForFunction(
        () =>
          document.querySelector('.text-diff .discussion-inline')?.previousElementSibling?.dataset.afterLine === '5',
      );
      assert.equal(await rowOf(), '5');
      assert.equal(
        await inspector.getByText('refers to an earlier version').count(),
        0,
        'the comment is current again',
      );
      assert.equal(await inspector.getByRole('button', { name: 'Suggest New Line', exact: true }).count(), 0);
      await capture(page, 'relocate-done-1440');
    });
  },
);

// HS2-9MZ32M: a saved image region is redrawn with keyboard and pointer, and a whole image can be commented.
test(
  'HS2-9MZ32M comments on a whole image and redraws its region by keyboard and pointer',
  {
    timeout: 90_000,
  },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const folder = join(dirname(repo), 'Regions');
      await mkdir(folder);
      const git = (...args) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
          cwd: folder,
          windowsHide: true,
        });
      const drawing = (fill) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e7eaef"/><circle cx="160" cy="90" r="62" fill="${fill}"/></svg>`;
      git('init', '-q', '--initial-branch=review');
      await writeFile(join(folder, 'mark.svg'), drawing('#506b91'));
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
      await writeFile(join(folder, 'mark.svg'), drawing('#3b7c68'));

      const button = (name) => page.getByRole('button', { name, exact: true });
      const inspector = page.getByRole('region', { name: 'Discussion' });
      const after = page.locator('[data-media-region-side="after"]');
      const saved = page.locator('.media-diff__region:not(.media-diff__region--draft)');
      const draft = page.locator('.media-diff__region--draft');
      const sent = (kind) =>
        page.waitForResponse(
          (reply) => reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.kind === kind,
        );
      const region = () =>
        saved.first().evaluate((element) => {
          const box = element.getBoundingClientRect();
          const frame = element.parentElement.getBoundingClientRect();
          return {
            left: (box.left - frame.left) / frame.width,
            top: (box.top - frame.top) / frame.height,
            width: box.width / frame.width,
            height: box.height / frame.height,
          };
        });
      const close = (actual, expected) => {
        for (const key of Object.keys(expected)) {
          assert(Math.abs(actual[key] - expected[key]) < 0.03, `${key}: ${actual[key]} vs ${expected[key]}`);
        }
      };
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(folder);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /mark\.svg/ }).click();
      await page.getByRole('img', { name: 'After image' }).waitFor();

      // A whole-image comment is a region over the full image.
      await button('Comment on Whole After Image').click();
      await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill('The palette changed.');
      const created = sent('create');
      await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
      assert((await created).ok());
      await inspector.getByText(/After image region/u).waitFor();
      await saved.first().waitFor();
      close(await region(), { left: 0, top: 0, width: 1, height: 1 });
      await capture(page, 'region-whole-1440');

      // Keyboard: shrink then move the region, and save with Enter.
      await inspector.getByRole('button', { name: 'Edit Region', exact: true }).click();
      await draft.waitFor();
      await after.focus();
      for (let step = 0; step < 6; step++) await page.keyboard.press('Shift+ArrowLeft');
      for (let step = 0; step < 6; step++) await page.keyboard.press('Shift+ArrowUp');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      const keyboardSave = sent('move');
      await page.keyboard.press('Enter');
      assert((await keyboardSave).ok());
      await draft.waitFor({ state: 'detached' });
      close(await region(), { left: 0.05, top: 0.05, width: 0.7, height: 0.7 });
      await inspector.getByText('The palette changed.').first().waitFor();
      await capture(page, 'region-keyboard-1440');

      // Cancel leaves the saved region alone.
      await inspector.getByRole('button', { name: 'Edit Region', exact: true }).click();
      await draft.waitFor();
      await inspector.getByRole('button', { name: 'Cancel', exact: true }).click();
      await draft.waitFor({ state: 'detached' });
      close(await region(), { left: 0.05, top: 0.05, width: 0.7, height: 0.7 });

      // Pointer: drag a new rectangle over the image.
      await inspector.getByRole('button', { name: 'Edit Region', exact: true }).click();
      await draft.waitFor();
      const frame = await after.boundingBox();
      const at = (x, y) => [frame.x + frame.width * x, frame.y + frame.height * y];
      const pointerSave = sent('move');
      await page.mouse.move(...at(0.4, 0.3));
      await page.mouse.down();
      await page.mouse.move(...at(0.55, 0.5), { steps: 4 });
      await page.mouse.move(...at(0.8, 0.9), { steps: 4 });
      await page.mouse.up();
      assert((await pointerSave).ok());
      await draft.waitFor({ state: 'detached' });
      close(await region(), { left: 0.4, top: 0.3, width: 0.4, height: 0.6 });
      await capture(page, 'region-pointer-1440');

      // The image changes before the person saves: the host refuses, and the draft returns for another try.
      await writeFile(join(folder, 'mark.svg'), drawing('#8a3b3b'));
      await inspector.getByRole('button', { name: 'Edit Region', exact: true }).click();
      await draft.waitFor();
      await after.focus();
      const refused = sent('move');
      await page.keyboard.press('Enter');
      assert.equal((await refused).status(), 409);
      await inspector.getByRole('alert').filter({ hasText: 'has changed' }).waitFor();
      await draft.waitFor();
      close(await region(), { left: 0.4, top: 0.3, width: 0.4, height: 0.6 });
      await capture(page, 'region-refused-1440');
    });
  },
);

// HS2-Q9TXER: the Diagram Renderers dialog reports what the host can render with and what is missing.
test(
  'HS2-Q9TXER shows renderer readiness, guides setup and notices a tool installed since launch',
  {
    timeout: 90_000,
  },
  async () => {
    const open = async (page, url) => {
      await page.goto(url);
      await page.getByRole('button', { name: 'Diagram Renderers', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Diagram Renderers' });
      await dialog.waitFor();
      return dialog;
    };
    const format = (dialog, id) => dialog.locator(`[data-renderer-format="${id}"]`);

    // No renderer: the dialog says which variable to set and that formats need one.
    await withWorkbench(async (page, url) => {
      const dialog = await open(page, url);
      await dialog.getByText('No Renderer Configured', { exact: true }).waitFor();
      await dialog.getByText(/Set GLASSBOX_CONTENT_RENDERER to the absolute path/u).waitFor();
      for (const id of ['graphviz', 'mermaid', 'plantuml']) {
        await format(dialog, id).getByText('Needs a Renderer', { exact: true }).waitFor();
      }
      await capture(page, 'renderers-none-1440');
      await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
      await dialog.waitFor({ state: 'hidden' });
    });

    // A custom renderer owns its tools, so its formats are not checked.
    await withWorkbench(
      async (page, url) => {
        const dialog = await open(page, url);
        await dialog.getByText('Custom Renderer', { exact: true }).waitFor();
        for (const id of ['graphviz', 'mermaid', 'plantuml']) {
          await format(dialog, id).getByText('Not Checked', { exact: true }).waitFor();
        }
      },
      { renderer: true },
    );

    // The local adapter: each format reports its own tools, and Check Again notices one installed later.
    const tools = (scratch) => ({
      adapter: join(scratch, process.platform === 'win32' ? 'glassbox-render-local.exe' : 'glassbox-render-local'),
      dot: join(scratch, 'dot'),
      java: join(scratch, 'java'),
      jar: join(scratch, 'plantuml.jar'),
    });
    await withWorkbench(
      async (page, url, _paths, settings) => {
        const scratch = dirname(settings);
        const dialog = await open(page, url);
        await dialog.getByText('Local Diagram Adapter', { exact: true }).waitFor();
        await format(dialog, 'graphviz').getByText('Ready', { exact: true }).waitFor();
        await format(dialog, 'mermaid').getByText('Needs Setup', { exact: true }).waitFor();
        await format(dialog, 'mermaid')
          .getByText(/set GLASSBOX_MERMAID_EXECUTABLE to its absolute path \(is not set\)/u)
          .waitFor();
        await format(dialog, 'mermaid')
          .getByText(/Install it from https:\/\/github\.com\/mermaid-js\/mermaid-cli/u)
          .waitFor();
        await format(dialog, 'plantuml')
          .getByText(/PlantUML jar: set GLASSBOX_PLANTUML_JAR.*does not point to a file/u)
          .waitFor();
        await capture(page, 'renderers-setup-1440');
        for (const width of [940, 390, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          await format(dialog, 'plantuml').waitFor();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
        }

        // Installing the jar after launch is noticed by Check Again; a variable change would need a restart.
        await writeFile(tools(scratch).jar, 'jar');
        await dialog.getByRole('button', { name: 'Check Again', exact: true }).click();
        await format(dialog, 'plantuml').getByText('Ready', { exact: true }).waitFor();
        await format(dialog, 'mermaid').getByText('Needs Setup', { exact: true }).waitFor();
        await dialog.getByText(/A change to a variable needs a restart/u).waitFor();
      },
      {
        environment: ({ scratch }) => {
          const path = tools(scratch);
          for (const file of [path.adapter, path.dot, path.java]) writeFileSync(file, 'x');
          return {
            GLASSBOX_CONTENT_RENDERER: path.adapter,
            GLASSBOX_GRAPHVIZ_EXECUTABLE: path.dot,
            GLASSBOX_JAVA_EXECUTABLE: path.java,
            GLASSBOX_PLANTUML_JAR: path.jar,
          };
        },
      },
    );
  },
);

// HS2-XJWGYD: both images pan and zoom together, one side can be focused and left again, regions keep their place.
test(
  'HS2-XJWGYD synchronizes pan and zoom gestures across unequal images and focuses one side',
  {
    timeout: 90_000,
  },
  async () => {
    await withWorkbench(async (page, url, { repo }) => {
      const folder = join(dirname(repo), 'Gestures');
      await mkdir(folder);
      const git = (...args) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
          cwd: folder,
          windowsHide: true,
        });
      // The before image is wide and the after image square, so their scrollable ranges differ.
      const drawing = (width, height, fill) =>
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#e7eaef"/><circle cx="${width / 2}" cy="${height / 2}" r="${height / 3}" fill="${fill}"/></svg>`;
      git('init', '-q', '--initial-branch=review');
      await writeFile(join(folder, 'mark.svg'), drawing(640, 360, '#506b91'));
      git('add', '.');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'initial');
      await writeFile(join(folder, 'mark.svg'), drawing(400, 400, '#3b7c68'));

      const button = (name) => page.getByRole('button', { name, exact: true });
      const before = page.locator('[data-media-region-side="before"]');
      const after = page.locator('[data-media-region-side="after"]');
      const zoomOf = () =>
        page
          .locator('.media-diff__image')
          .first()
          .evaluate((element) => element.style.width);
      const position = (locator) =>
        locator.evaluate((element) => ({
          x: element.scrollLeft / Math.max(1, element.scrollWidth - element.clientWidth),
          y: element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight),
          reach: element.scrollHeight - element.clientHeight,
        }));
      const regionFraction = () =>
        page
          .locator('.media-diff__region:not(.media-diff__region--draft)')
          .first()
          .evaluate((region) => {
            const image = region.closest('.media-diff__image').querySelector('img').getBoundingClientRect();
            const box = region.getBoundingClientRect();
            return {
              left: (box.left - image.left) / image.width,
              top: (box.top - image.top) / image.height,
              width: box.width / image.width,
              height: box.height / image.height,
            };
          });
      const close = (actual, expected, tolerance = 0.03) => {
        for (const key of Object.keys(expected)) {
          assert(Math.abs(actual[key] - expected[key]) <= tolerance, `${key}: ${actual[key]} vs ${expected[key]}`);
        }
      };
      await page.goto(url);
      await page.getByRole('textbox', { name: 'Repository Path', exact: true }).fill(folder);
      await button('Open Comparison').click();
      await page.getByRole('treeitem', { name: /mark\.svg/ }).click();
      await page.getByRole('img', { name: 'After image' }).waitFor();
      await page.getByRole('img', { name: 'Before image' }).waitFor();

      // A saved region on the after image, drawn with the keyboard.
      await button('Add Region Comment').click();
      await after.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const inspector = page.getByRole('region', { name: 'Discussion' });
      await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill('Check the circle.');
      const created = page.waitForResponse(
        (reply) => reply.url().endsWith('/discussion') && reply.request().postDataJSON().operation?.kind === 'create',
      );
      await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
      assert((await created).ok());
      await page.locator('.media-diff__region:not(.media-diff__region--draft)').first().waitFor();
      const saved = await regionFraction();
      close(saved, { left: 0.4, top: 0.4, width: 0.3, height: 0.3 });

      // Ctrl with the wheel zooms both images together, in steps, up to the toolbar's limit.
      assert.equal(await zoomOf(), '100%');
      const frame = await after.boundingBox();
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await page.keyboard.down('Control');
      for (let step = 0; step < 8; step++) await page.mouse.wheel(0, -100);
      await page.keyboard.up('Control');
      await page.waitForFunction(() => document.querySelector('.media-diff__image')?.style.width === '300%');
      assert.deepEqual(
        await page
          .locator('.media-diff__image')
          .evaluateAll((elements) => elements.map((element) => element.style.width)),
        ['300%', '300%'],
      );
      close(await regionFraction(), saved);
      await capture(page, 'gestures-zoom-1440');

      // Panning one pane moves the other to the same relative spot, whichever pane is dragged.
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await page.mouse.wheel(0, 200);
      await page.waitForFunction(() => document.querySelector('[data-media-region-side="after"]').scrollTop > 0);
      await page.waitForFunction(() => document.querySelector('[data-media-region-side="before"]').scrollTop > 0);
      const afterPan = await position(after);
      const beforePan = await position(before);
      assert(afterPan.reach > 0 && beforePan.reach > 0 && afterPan.reach !== beforePan.reach, 'the ranges differ');
      close(beforePan, { x: afterPan.x, y: afterPan.y }, 0.04);
      const side = await before.boundingBox();
      const previous = await after.evaluate((element) => element.scrollTop);
      await page.mouse.move(side.x + side.width / 2, side.y + side.height / 2);
      await page.mouse.wheel(0, 150);
      await page.waitForFunction(
        (earlier) => document.querySelector('[data-media-region-side="after"]').scrollTop !== earlier,
        previous,
      );
      const synced = await position(before);
      close(await position(after), { x: synced.x, y: synced.y }, 0.04);
      close(await regionFraction(), saved);
      await capture(page, 'gestures-pan-1440');

      // Focus shows one side alone at the same zoom; Exit Focus and Escape bring the earlier view back.
      await button('Focus After Image').click();
      await before.waitFor({ state: 'detached' });
      await button('Exit Focus').waitFor();
      assert.equal(await zoomOf(), '300%');
      close(await regionFraction(), saved);
      await page.keyboard.down('Control');
      await page.mouse.move(frame.x + frame.width / 2, frame.y + 100);
      await page.mouse.wheel(0, 100);
      await page.keyboard.up('Control');
      await page.waitForFunction(() => document.querySelector('.media-diff__image')?.style.width === '275%');
      close(await regionFraction(), saved);
      await capture(page, 'gestures-focus-1440');
      await button('Exit Focus').click();
      await before.waitFor();
      await after.waitFor();
      assert.equal(await zoomOf(), '300%', 'leaving focus restores the zoom it started from');
      assert.equal(await button('Exit Focus').count(), 0);
      close(await regionFraction(), saved);

      await button('Focus Before Image').click();
      await after.waitFor({ state: 'detached' });
      await before.focus();
      await page.keyboard.press('Escape');
      await after.waitFor();
      assert.equal(await button('Exit Focus').count(), 0);

      // Choosing a mode from the toolbar is not a focus, so there is nothing to exit.
      await button('After Image').click();
      await before.waitFor({ state: 'detached' });
      assert.equal(await button('Exit Focus').count(), 0);
      await button('Side by Side').click();
      for (const width of [940, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      }
    });
  },
);
