import assert from 'node:assert/strict';
import test from 'node:test';

import { changeRegion, initialRegion, regionAnchor } from '../src/components/diff/media-region.ts';

test('keyboard region movement and resizing stay inside the selected side', () => {
  let bounds = { ...initialRegion };
  for (let i = 0; i < 25; i++) {
    bounds = changeRegion(bounds, 'ArrowRight', false);
    bounds = changeRegion(bounds, 'ArrowDown', false);
  }
  assert.deepEqual(bounds, { left: 70, top: 70, width: 30, height: 30 });
  assert.deepEqual(changeRegion(bounds, 'ArrowDown', true), bounds);
  assert.deepEqual(changeRegion(bounds, 'ArrowRight', true), bounds);
  for (let i = 0; i < 25; i++) {
    bounds = changeRegion(bounds, 'ArrowLeft', true);
    bounds = changeRegion(bounds, 'ArrowUp', true);
    bounds = changeRegion(bounds, 'ArrowLeft', false);
    bounds = changeRegion(bounds, 'ArrowUp', false);
  }
  assert.deepEqual(regionAnchor(bounds), { kind: 'image_region', left: 0, top: 0, width: 0.05, height: 0.05 });
  assert.equal(changeRegion(bounds, 'Tab', false), undefined);
  assert.deepEqual(initialRegion, { left: 35, top: 35, width: 30, height: 30 });
});
