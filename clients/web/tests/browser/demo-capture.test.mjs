import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { runRepeatedScene, runScene } from '../../demo-capture/capture.mjs';
import { comparisonScenes } from '../../demo-capture/comparison-scenes.mjs';
import { differingArtifacts, validateScene } from '../../demo-capture/scene.mjs';
import { scenes } from '../../demo-capture/scenes.mjs';

const expected = {
  'direct-comparison': ['direct-comparison.png', 'direct-comparison.svg'],
  'image-comparison': ['image-comparison.png', 'image-comparison.svg'],
  'review-analysis': ['review-analysis.png', 'review-analysis.svg'],
  'review-comment': ['review-comment.png', 'review-comment.svg'],
  'review-handoff': ['review-handoff.png', 'review-handoff.svg'],
  'review-outline': ['review-outline.png', 'review-outline.svg'],
  'review-tour': [
    'review-tour-comment.png',
    'review-tour-dark.png',
    'review-tour-diff.png',
    'review-tour-files.png',
    'review-tour.svg',
  ],
};

function accessibleText(svg) {
  return [...svg.matchAll(/aria-label="([^"]+)"/gu)].map((match) => match[1]).join(' ');
}

async function retainDivergentCaptures(runs, differing) {
  const captureDirectory = process.env.GLASSBOX_BROWSER_CAPTURES;
  if (captureDirectory === undefined || differing.length === 0) return;
  const directory = join(captureDirectory, 'demo-repeat-failures');
  await mkdir(directory, { recursive: true });
  for (const [index, artifacts] of runs.entries()) {
    for (const name of differing) {
      if (artifacts[name] !== undefined) await writeFile(join(directory, `run-${index + 1}-${name}`), artifacts[name]);
    }
  }
}

for (const scene of scenes) {
  test(`HS2-5HS40W ${scene.id} produces identical bytes on every run`, { timeout: 300_000 }, async () => {
    const runs = await runRepeatedScene(scene, 3);
    assert.deepEqual(Object.keys(runs[0]).sort(), expected[scene.id]);
    const differing = differingArtifacts(runs);
    await retainDivergentCaptures(runs, differing);
    assert.deepEqual(differing, []);
    for (const bytes of Object.values(runs[0])) assert(bytes.length > 0);
    const svg = runs[0][`${scene.id}.svg`].toString('utf8');
    assert.match(svg, /<svg\b/u);
    // The captured text stays readable through the SVG's accessible labels.
    assert(svg.includes(scene.id === 'direct-comparison' ? 'aria-label="release-notes.txt' : 'aria-label="Fieldnotes'));
    if (scene.id === 'review-analysis') {
      assert(svg.includes('aria-label="Highest Risk First"'), 'shows the risk order');
      assert(svg.includes('aria-label="the previous summary"'), 'shows the cited note');
    }
  });
}

test(
  'HS2-5HS40W loading, empty and error frames appear only when a scene asks for them',
  { timeout: 300_000 },
  async () => {
    const scene = validateScene({
      id: 'opt-in-states',
      title: 'The states a capture never shows by accident',
      suites: ['comparison'],
      kind: 'animation',
      viewport: { width: 1440, height: 900 },
      scheme: 'light',
      frames: [
        { name: 'loading', state: 'loading', steps: [] },
        { name: 'empty', state: 'empty', steps: [] },
        { name: 'error', state: 'error', steps: [] },
      ],
    });
    const artifacts = await runScene(scene);
    const frames = ['loading', 'empty', 'error'].map((name) => artifacts[`opt-in-states-${name}.png`]);
    for (const frame of frames) assert(frame.length > 0);
    assert.equal(new Set(frames.map((frame) => frame.toString('base64'))).size, 3, 'each state looks different');
    // The empty review is the quiet repository, which the SVG labels by name.
    assert.match(artifacts['opt-in-states.svg'].toString('utf8'), /aria-label="Quiet/u);
    const labels = accessibleText(artifacts['opt-in-states.svg'].toString('utf8'));
    assert(labels.includes('Repository folder not found. Check the path and try again.'), 'shows the recovery message');
    // A settled scene never captures a held request: its first frame is already a populated review.
    const settled = await runScene({ ...scenes[0], id: 'settled-check' });
    assert.notDeepEqual(settled['settled-check.png'], frames[0]);
  },
);

test('HS2-5TFS63 comparison captures real states at desktop and compact widths', { timeout: 180_000 }, async () => {
  const cases = {
    'workbench-error-narrow-dark': 'Repository folder not found.',
    'workbench-empty-medium-light': 'No Changed Files',
    'workbench-loading-wide-dark': 'Git Repository',
  };
  for (const [id, content] of Object.entries(cases)) {
    const scene = comparisonScenes.find((entry) => entry.id === id);
    assert(scene, id);
    const artifacts = await runScene(scene);
    const svg = artifacts[id + '.svg'].toString('utf8');
    assert(accessibleText(svg).toLowerCase().includes(content.toLowerCase()), id + ' shows the expected state');
  }
});
