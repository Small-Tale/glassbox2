import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { createAppearanceState } from '../src/components/settings/appearance-state.ts';

test('default System loads a saved appearance and ignores a superseded boot response', async () => {
  const settings = Promise.withResolvers();
  const state = createAppearanceState(
    () => settings.promise,
    async () => {},
  );
  assert.equal(state.appearance.value, 'system');
  const load = state.load();
  await state.choose('dark');
  settings.resolve('light');
  await load;
  assert.equal(state.appearance.value, 'dark');
});

test('rapid choices persist in order and a failed latest write rolls back', async () => {
  const first = Promise.withResolvers();
  const saves = [];
  const state = createAppearanceState(
    async () => 'dark',
    async (value) => {
      saves.push(value);
      if (value === 'light') await first.promise;
      if (value === 'system') throw new Error('Disk failure');
    },
  );
  await state.load();
  assert.equal(state.appearance.value, 'dark');
  const light = state.choose('light');
  const system = state.choose('system');
  assert.equal(state.appearance.value, 'system');
  await setImmediate();
  assert.deepEqual(saves, ['light']);
  first.resolve();
  await light;
  await system;
  assert.deepEqual(saves, ['light', 'system']);
  assert.equal(state.appearance.value, 'light');
  assert.equal(state.status.value, 'Appearance could not be saved.');
  await state.choose('dark');
  assert.equal(state.appearance.value, 'dark');
  assert.equal(state.status.value, '');
});
