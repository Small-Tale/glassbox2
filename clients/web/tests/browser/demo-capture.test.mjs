import assert from 'node:assert/strict';
import test from 'node:test';

import { runScene } from '../../demo-capture/capture.mjs';
import { differingArtifacts, validateScene } from '../../demo-capture/scene.mjs';
import { scenes } from '../../demo-capture/scenes.mjs';

const expected = {
  'review-comment': ['review-comment.png', 'review-comment.svg'],
  'review-tour': [
    'review-tour-comment.png',
    'review-tour-dark.png',
    'review-tour-diff.png',
    'review-tour-files.png',
    'review-tour.svg',
  ],
};

for (const scene of scenes) {
  test(`HS2-5HS40W ${scene.id} produces identical bytes on every run`, { timeout: 300_000 }, async () => {
    const runs = [await runScene(scene), await runScene(scene), await runScene(scene)];
    assert.deepEqual(Object.keys(runs[0]).sort(), expected[scene.id]);
    assert.deepEqual(differingArtifacts(runs), []);
    for (const bytes of Object.values(runs[0])) assert(bytes.length > 0);
    const svg = runs[0][`${scene.id}.svg`].toString('utf8');
    assert.match(svg, /<svg\b/u);
    // The captured text stays readable through the SVG's accessible labels.
    assert.match(svg, /aria-label="Fieldnotes/u);
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
    const labels = [...artifacts['opt-in-states.svg'].toString('utf8').matchAll(/aria-label="([^"]+)"/gu)]
      .map((match) => match[1])
      .join(' ');
    assert(labels.includes('Repository folder not found. Check the path and try again.'), 'shows the recovery message');
    // A settled scene never captures a held request: its first frame is already a populated review.
    const settled = await runScene({ ...scenes[0], id: 'settled-check' });
    assert.notDeepEqual(settled['settled-check.png'], frames[0]);
  },
);
