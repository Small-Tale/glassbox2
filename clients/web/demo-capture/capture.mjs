// HS2-5HS40W: runs one scene against the real built workbench and returns its artifacts as bytes.
//
// Determinism comes from construction: a fixed window, scheme, locale and time zone; a frozen clock, random source and
// id source in the page; animations, transitions and the caret switched off; and a named ready state before every
// frame. Nothing here waits for a duration. The runner compares the bytes of repeated runs (`run.mjs`).

import { chromium } from 'playwright';
import {
  captureElementTree,
  clearEmbeddedFonts,
  elementTreeToSvg,
  elementTreeToSvgInner,
  generateAnimatedSvg,
  getEmbeddedFontFaceCss,
} from 'domotion-svg';

import { buildAnalysisFixture, fixtureTime, startHost } from './host.mjs';

const frozenTime = Date.parse(fixtureTime);

/** Runs before any page script: a fixed clock, a seeded random source, and sequential ids. */
function freezeNondeterminism(time) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(time);
      else super(...args);
    }
    static now() {
      return time;
    }
  }
  window.Date = FixedDate;
  let seed = 0x9e3779b9;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let counter = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
}

const quiet = `
  *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
  html { scroll-behavior: auto !important; }
`;

/** A named state is reached when the real workbench shows it. These are the only synchronisation points. */
const readyStates = {
  'source-entry': (page) => page.getByRole('textbox', { name: 'Repository Path', exact: true }).waitFor(),
  review: (page) => page.getByRole('treeitem').first().waitFor(),
  diff: (page) =>
    page
      .getByRole('button', { name: /^Add Comment to (After|Before) Line \d+$/u })
      .first()
      .waitFor(),
  'comment-saved': (page) =>
    page.getByRole('region', { name: 'Discussion' }).getByText('Saves automatically', { exact: true }).waitFor(),
  media: (page) =>
    page.waitForFunction(() => {
      const image = document.querySelector('img[data-media-side="after"]');
      return image instanceof HTMLImageElement && image.naturalWidth > 0;
    }),
  outline: (page) =>
    page
      .getByRole('dialog', { name: 'Symbol Outline' })
      .getByRole('tree', { name: 'Symbols' })
      .getByRole('treeitem')
      .first()
      .waitFor(),
  'share-menu': (page) => page.getByRole('menuitem', { name: 'Copy AI Instruction', exact: true }).waitFor(),
  'analysis-risk': (page) => page.getByText('Highest Risk First', { exact: true }).waitFor(),
  'analysis-narrative': (page) => page.getByText('Review in This Order', { exact: true }).waitFor(),
  async 'analysis-note'(page) {
    const inspector = page.getByRole('region', { name: 'Discussion' });
    await inspector.getByRole('button', { name: 'the previous summary', exact: true }).waitFor();
    await readyStates.diff(page);
    await inspector.getByText('This comment refers to an earlier version of the file.').waitFor({ state: 'hidden' });
  },
};

const optInStates = {
  async loading(page, context) {
    // The files response is held behind a promise, so the loading state lasts exactly as long as the capture needs.
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/v1/review/files*', async (route) => {
      await held;
      await route.continue();
    });
    context.release = release;
    await openComparison(page, context.paths.changed);
    await page.getByRole('status').first().waitFor();
  },
  async empty(page, context) {
    await openComparison(page, context.paths.clean);
    await page.getByText('No Changed Files', { exact: true }).first().waitFor();
  },
  async error(page, context) {
    // A repository that does not exist fails with the host's real error, so the fixture cannot drift from it.
    await openComparison(page, context.paths.missing);
    await page.getByRole('alert').first().waitFor();
  },
};

async function openComparison(page, repository) {
  const path = page.getByRole('textbox', { name: 'Repository Path', exact: true });
  // Once a review is open the source form is collapsed behind Change Source.
  if (!(await path.isVisible())) await page.getByRole('button', { name: 'Change Source', exact: true }).click();
  await path.fill(repository);
  await page.getByRole('button', { name: 'Open Comparison', exact: true }).click();
}

const stepRunners = {
  async 'open-comparison'(page, _step, context) {
    await openComparison(page, context.paths.changed);
    await readyStates.review(page);
  },
  async 'open-direct-comparison'(page, _step, context) {
    await page.getByRole('combobox', { name: 'Compare' }).click();
    await page.getByRole('option', { name: 'Files or Folders', exact: true }).click();
    await page.getByRole('textbox', { name: 'Before Path', exact: true }).fill(context.paths.before);
    await page.getByRole('textbox', { name: 'After Path', exact: true }).fill(context.paths.after);
    await page.getByRole('button', { name: 'Open Comparison', exact: true }).click();
    await readyStates.review(page);
  },
  async 'select-file'(page, step) {
    await page
      .getByRole('treeitem', { name: new RegExp(step.name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u') })
      .click();
  },
  async 'order-files'(page, step) {
    await page.getByRole('button', { name: step.order === 'risk' ? 'Risk' : 'Narrative', exact: true }).click();
    await readyStates[`analysis-${step.order}`](page);
  },
  async 'open-ai-note'(page) {
    await page.getByRole('button', { name: /AI note.*resolved notes/u }).click();
  },
  async 'open-outline'(page) {
    await page.getByRole('button', { name: 'Symbol Outline', exact: true }).click();
  },
  async 'open-share-menu'(page) {
    await page.getByRole('button', { name: 'Share Feedback', exact: true }).click();
  },
  async 'widen-file-rail'(page) {
    const handle = page.getByRole('separator', { name: /Changed Files/u });
    await handle.press('End');
    await handle.blur();
  },
  async comment(page, step) {
    await page.getByRole('button', { name: `Add Comment to After Line ${step.line}`, exact: true }).focus();
    await page.keyboard.press('Enter');
    const inspector = page.getByRole('region', { name: 'Discussion' });
    await inspector.getByRole('textbox', { name: 'Comment', exact: true }).fill(step.text);
    const created = page.waitForResponse((response) => response.url().endsWith('/discussion') && response.ok());
    await inspector.getByRole('button', { name: 'Add Comment', exact: true }).click();
    await created;
  },
  async appearance(page, step) {
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    const saved = page.waitForResponse(
      (response) => response.url().endsWith('/api/v1/settings') && response.request().method() === 'PUT',
    );
    await page.getByRole('menuitemcheckbox', { name: step.scheme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
    await saved;
    await page.waitForFunction((scheme) => document.documentElement.dataset.kuiScheme === scheme, step.scheme);
    // Choosing a scheme leaves the menu open, and an open menu is not part of the scene.
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
  },
};

async function frameTree(page, viewport) {
  const tree = await captureElementTree(page, 'body', { x: 0, y: 0, ...viewport });
  return tree;
}

/**
 * Runs `scene` on a fresh host and browser and returns its artifacts: `<id>.png` and `<id>.svg` for a still, and
 * `<id>.svg` (animated) plus one `<id>-<frame>.png` per frame for an animation.
 */
async function captureScene(scene, analysisFixture) {
  const host = await startHost(analysisFixture);
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: scene.viewport,
      deviceScaleFactor: 1,
      colorScheme: scene.scheme,
      locale: 'en-US',
      timezoneId: 'UTC',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.addInitScript(freezeNondeterminism, frozenTime);
    await page.goto(host.url);
    await page.addStyleTag({ content: quiet });
    await readyStates['source-entry'](page);

    const artifacts = {};
    const trees = [];
    const state = { paths: host.paths };
    clearEmbeddedFonts();
    for (const frame of scene.frames) {
      for (const step of frame.steps) await stepRunners[step.action](page, step, state);
      if (frame.state) await optInStates[frame.state](page, state);
      else await readyStates[frame.ready](page);
      const png = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      artifacts[scene.kind === 'still' ? `${scene.id}.png` : `${scene.id}-${frame.name}.png`] = png;
      trees.push({ tree: await frameTree(page, scene.viewport), hold: frame.hold ?? 1600 });
      if (state.release) {
        state.release();
        state.release = undefined;
        await readyStates.review(page);
      }
    }

    const { width, height } = scene.viewport;
    if (scene.kind === 'still') {
      artifacts[`${scene.id}.svg`] = Buffer.from(elementTreeToSvg(trees[0].tree, width, height));
    } else {
      const frames = trees.map(({ tree, hold }, index) => ({
        svgContent: elementTreeToSvgInner(tree, width, height, `f${index}-`, true, 2, false),
        duration: hold,
        transition: { type: 'crossfade', duration: 300 },
      }));
      artifacts[`${scene.id}.svg`] = Buffer.from(
        generateAnimatedSvg({ width, height, frames, fontFaceCss: getEmbeddedFontFaceCss(), background: '#ffffff' }),
      );
    }
    return artifacts;
  } finally {
    await browser?.close();
    await host.stop();
  }
}

export async function runRepeatedScene(scene, count) {
  const analysisFixture = scene.analysis === 'fixture' ? await buildAnalysisFixture() : undefined;
  try {
    const runs = [];
    for (let run = 0; run < count; run += 1) runs.push(await captureScene(scene, analysisFixture));
    return runs;
  } finally {
    await analysisFixture?.stop();
  }
}

export async function runScene(scene) {
  const [artifacts] = await runRepeatedScene(scene, 1);
  return artifacts;
}
