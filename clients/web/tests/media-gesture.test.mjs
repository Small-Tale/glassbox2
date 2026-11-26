import assert from 'node:assert/strict';
import test from 'node:test';

import {
  maxZoom,
  minZoom,
  scrollFraction,
  scrollTarget,
  zoomForWheel,
  zoomStep,
} from '../src/components/diff/media-gesture.ts';

// HS2-XJWGYD: both images follow one position and one zoom.
test('a scroll position maps to the same fraction of another scroller with a different range', () => {
  assert.equal(scrollFraction(0, 600), 0);
  assert.equal(scrollFraction(300, 600), 0.5);
  assert.equal(scrollFraction(600, 600), 1);
  assert.equal(scrollTarget(0.5, 1200), 600);
  assert.equal(scrollTarget(0.25, 80), 20);
  // A larger image and a smaller one stay on the same relative spot.
  assert.equal(scrollTarget(scrollFraction(450, 900), 300), 150);
});

test('degenerate and out-of-range scrolls are clamped and never produce NaN', () => {
  assert.equal(scrollFraction(10, 0), 0, 'nothing scrolls, so there is no fraction');
  assert.equal(scrollFraction(10, -5), 0);
  assert.equal(scrollFraction(-40, 600), 0);
  assert.equal(scrollFraction(900, 600), 1);
  assert.equal(scrollTarget(0.7, 0), 0, 'a target that cannot scroll stays at its start');
  assert.equal(scrollTarget(2, 100), 100);
  assert.equal(scrollTarget(-1, 100), 0);
  assert.equal(scrollTarget(Number.NaN, 100), 0, 'a missing fraction starts at the beginning');
});

test('the wheel zooms by one step per gesture and stops at the toolbar limits', () => {
  assert.equal(zoomForWheel(100, -120), 100 + zoomStep, 'wheel up zooms in');
  assert.equal(zoomForWheel(150, 120), 150 - zoomStep, 'wheel down zooms out');
  assert.equal(zoomForWheel(minZoom, 120), minZoom, 'cannot go below 100%');
  assert.equal(zoomForWheel(maxZoom, -120), maxZoom, 'cannot go above 400%');
  assert.equal(zoomForWheel(200, 0), 200, 'no movement does nothing');
  assert.equal(zoomForWheel(200, -1), 225, 'a small trackpad pinch still counts as one step');
});
