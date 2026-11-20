import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const executable = join(root, 'target', 'debug', `glassbox-server${process.platform === 'win32' ? '.exe' : ''}`);
const captures = process.env.GLASSBOX_BROWSER_CAPTURES;

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

async function withWorkbench(exercise, { launchArgs = () => [], renderer = false } = {}) {
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
    host = spawn(executable, ['--assets', join(root, 'clients', 'web', 'dist'), ...launchArgs(paths)], {
      cwd: root,
      env: {
        ...process.env,
        GLASSBOX_SETTINGS_DIRECTORY: settings,
        GLASSBOX_FEEDBACK_DIRECTORY: join(scratch, 'feedback'),
        GLASSBOX_CONTENT_RENDERER: rendererPath,
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
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error));
    try {
      await exercise(page, `http://${address}`, paths, settings);
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

test('built workbench opens the only file supplied by Git difftool', { timeout: 60_000 }, async () => {
  await withWorkbench(
    async (page, url) => {
      await page.goto(url);
      await page.getByRole('heading', { name: 'after.txt', exact: true }).waitFor();
      await page.locator('.text-diff').getByText('after', { exact: true }).waitFor();
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
      await button('Change Source').click();
      await button('Open Comparison').click();
      await page.getByRole('heading', { name: 'Review', exact: true }).waitFor();
      assert(await button('Previous File Visit').isDisabled());
    });
  },
);
