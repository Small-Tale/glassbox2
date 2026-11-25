import assert from 'node:assert/strict';
import test from 'node:test';

import { modeAvailable, modeForImages } from '../src/components/diff/media-mode.ts';

const image = { source: undefined };
const svg = { source: '<svg/>' };
const both = { before: image, after: image };
const added = { before: null, after: image };
const removed = { before: image, after: null };

test('HS2-Q3X4BX mode availability follows the images present', () => {
  for (const mode of ['split', 'metadata']) {
    for (const images of [both, added, removed]) assert.equal(modeAvailable(mode, images), true, mode);
  }
  for (const mode of ['stack', 'difference', 'slice']) {
    assert.equal(modeAvailable(mode, both), true, mode);
    assert.equal(modeAvailable(mode, added), false, mode);
    assert.equal(modeAvailable(mode, removed), false, mode);
  }
  assert.equal(modeAvailable('before', removed), true);
  assert.equal(modeAvailable('before', added), false);
  assert.equal(modeAvailable('after', added), true);
  assert.equal(modeAvailable('after', removed), false);
  assert.equal(modeAvailable('source', both), false, 'raster images have no source');
  assert.equal(modeAvailable('source', { before: svg, after: image }), true);
  assert.equal(modeAvailable('source', { before: null, after: svg }), true);
});

test('HS2-Q3X4BX the chosen mode is kept when supported and falls back to Side by Side otherwise', () => {
  assert.deepEqual(modeForImages('stack', both), { mode: 'stack', fellBack: false });
  assert.deepEqual(modeForImages('stack', added), { mode: 'split', fellBack: true });
  assert.deepEqual(modeForImages('before', both), { mode: 'before', fellBack: false });
  assert.deepEqual(modeForImages('before', added), { mode: 'split', fellBack: true });
  assert.deepEqual(modeForImages('source', both), { mode: 'split', fellBack: true });
  assert.deepEqual(modeForImages('split', added), { mode: 'split', fellBack: false });
});
