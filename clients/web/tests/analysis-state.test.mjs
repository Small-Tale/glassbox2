import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnalysisState } from '../src/components/analysis/analysis-state.ts';

const source = { kind: 'difftool' };
const selected = { path: 'src/bundle.ts', revision: 'one' };

test('modes operate independently, reuse matching results, and reset when changing comparisons', async () => {
  const started = [];
  let completed = 0;
  const state = createAnalysisState(() => completed++, {
    start: (_, mode) => {
      started.push(mode);
      return Promise.resolve({ id: started.length, status: 'complete', result: { files: [selected], skipped: [] } });
    },
  });
  state.setSource(source);
  await Promise.all([state.toggle('risk', selected), state.toggle('guidance', selected)]);
  assert.equal(state.modes.risk.enabled.value, true);
  assert.equal(state.modes.guidance.enabled.value, true);
  assert.equal(completed, 2);
  await state.toggle('risk', selected);
  assert.equal(state.modes.risk.enabled.value, false);
  assert.equal(state.modes.guidance.enabled.value, true);
  await state.toggle('risk', selected);
  assert.deepEqual(started, ['risk', 'guidance']);
  state.setSource({ kind: 'paths', before: 'before', after: 'after' });
  assert.equal(state.modes.risk.enabled.value, false);
  assert.equal(state.modes.guidance.enabled.value, false);
  assert.equal(state.modes.risk.status.value, null);
});

test('a late start is cancelled and does not change a replacement analysis', async () => {
  const first = Promise.withResolvers();
  const cancelled = [];
  let starts = 0;
  const state = createAnalysisState(() => assert.fail('no completion expected'), {
    start: () =>
      ++starts === 1 ? first.promise : Promise.resolve({ id: 2, status: 'unavailable', message: 'No model.' }),
    cancel: (id) => {
      cancelled.push(id);
      return Promise.resolve();
    },
  });
  state.setSource(source);
  const old = state.toggle('risk', selected);
  await state.toggle('risk', selected);
  await state.toggle('risk', selected);
  first.resolve({ id: 1, status: 'running', completed: 0, total: 1 });
  await old;
  assert.deepEqual(cancelled, [1]);
  assert.equal(state.modes.risk.status.value.message, 'No model.');
});
