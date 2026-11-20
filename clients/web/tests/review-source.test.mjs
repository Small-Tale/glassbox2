import assert from 'node:assert/strict';
import test from 'node:test';

import { createReviewSourceState } from '../src/components/review/review-source.ts';

const source = { kind: 'paths', before: '/before', after: '/after' };
const review = { identity: 'project', branch: null, comparison: 'Direct comparison', files: [] };

test('only single-file difftool launches automatically select the changed file', async () => {
  const first = { path: 'a.ts', previous_path: null, status: 'modified' };
  const second = { path: 'b.ts', previous_path: null, status: 'modified' };
  let files = [first];
  const state = createReviewSourceState(review, async () => ({ ...review, files }));
  const difftool = { kind: 'difftool' };
  await state.open(difftool);
  assert.equal(state.selected.value, 0);
  await state.open(source);
  assert.equal(state.selected.value, undefined);
  files = [first, second];
  await state.open(difftool);
  assert.equal(state.selected.value, undefined);
  files = [];
  await state.open(difftool);
  assert.equal(state.selected.value, undefined);
});

test('a later source request wins and resets selection, filter and collapsed folders', async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const loads = [first.promise, second.promise];
  const state = createReviewSourceState(review, () => loads.shift());
  state.selected.value = 0;
  state.filter.value = 'README';
  state.collapsed.value = new Set(['folder:src']);
  const older = state.open(source);
  const newer = state.open(source);
  const result = { ...review, identity: 'newer' };
  second.resolve(result);
  await newer;
  first.resolve(review);
  await older;
  assert.equal(state.review.value, result);
  assert.equal(state.selected.value, undefined);
  assert.equal(state.filter.value, '');
  assert.equal(state.collapsed.value.size, 0);
  assert.equal(state.formOpen.value, false);
  assert.equal(state.pending.value, false);
});

test('a failed source preserves the active review and allows another attempt', async () => {
  const next = { ...review, identity: 'replacement' };
  const state = createReviewSourceState(review, async (request) => {
    if (request === source) throw new Error('Missing directory');
    return next;
  });
  state.selected.value = 0;
  await state.open(source);
  assert.equal(state.review.value, review);
  assert.equal(state.selected.value, 0);
  assert.equal(state.error.value, 'Missing directory');
  assert.equal(state.formOpen.value, true);
  await state.open({ ...source });
  assert.equal(state.review.value, next);
  assert.equal(state.error.value, '');
  assert.equal(state.selected.value, undefined);
});

test('file action status follows the latest action for the current selection', async () => {
  const first = Promise.withResolvers();
  const second = Promise.withResolvers();
  const actions = [first.promise, second.promise];
  const calls = [];
  const file = { path: 'src/a.ts', previous_path: null, status: 'modified' };
  const loaded = { ...review, files: [file] };
  const state = createReviewSourceState(
    loaded,
    async () => loaded,
    (...args) => {
      calls.push(args);
      return actions.shift();
    },
  );
  await state.open(source);
  state.selected.value = 0;
  const old = state.runFileAction('copy_relative');
  const latest = state.runFileAction('copy_absolute');
  assert.deepEqual(calls, [
    ['copy_relative', source, 0, file.path],
    ['copy_absolute', source, 0, file.path],
  ]);
  second.resolve('Absolute path copied.');
  await latest;
  first.reject(new Error('Clipboard denied.'));
  await old;
  assert.equal(state.fileActionStatus.value, 'Absolute path copied.');
  await state.open({ ...source });
  assert.equal(state.fileActionStatus.value, '');
});
