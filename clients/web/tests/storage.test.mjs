import assert from 'node:assert/strict';
import test from 'node:test';

import { createStorageState } from '../src/components/settings/storage-state.ts';

test('cleanup requires a selected scope, supports cancel and refreshes after retry', async () => {
  let bundles = 2;
  let rounds = 0;
  const state = createStorageState(
    () => Promise.resolve({ bytes: bundles * 1000, bundles, projects: [] }),
    (scope) => {
      assert.deepEqual(scope, { kind: 'project', project: '/one' });
      rounds++;
      if (rounds === 1) return Promise.reject(new Error('Try again.'));
      bundles = 1;
      return Promise.resolve({ removed_bundles: 1, reclaimed_bytes: 1000, active_bundles: 0, problems: [] });
    },
  );
  await state.refresh();
  state.confirm({ kind: 'all' });
  state.confirm(null);
  await state.clear();
  assert.equal(rounds, 0);
  state.confirm({ kind: 'project', project: '/one' });
  await state.clear();
  assert.equal(state.error.value, 'Try again.');
  assert.deepEqual(state.scope.value, { kind: 'project', project: '/one' });
  await state.clear();
  assert.equal(state.usage.value.bundles, 1);
  assert.equal(state.report.value.removed_bundles, 1);
  assert.equal(state.scope.value, null);
});
