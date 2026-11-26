import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { signal } from 'kerfjs';

import { createReviewProgress, fileRevision, watchReviewProgress } from '../src/components/review/review-progress.ts';
import { createReviewSourceState } from '../src/components/review/review-source.ts';

// HS2-FTEQVQ: reviewed marks follow the open comparison and never count a file whose content moved on.
const turn = () => setImmediate();
const files = [
  { path: 'a.rs', status: 'modified', previous_path: null },
  { path: 'b.rs', status: 'modified', previous_path: null },
];

async function fixture(fetchers, comparison = files) {
  const state = createReviewSourceState(undefined, async () => ({
    identity: 'working',
    branch: null,
    comparison: 'Direct comparison',
    files: comparison,
  }));
  await state.open({ kind: 'paths', before: '/a', after: '/b' });
  const content = signal({ kind: 'text', revision: 'r-a' });
  const progress = createReviewProgress(state, content, fetchers);
  const stop = watchReviewProgress(progress);
  await turn();
  return { state, content, progress: { ...progress, stop } };
}

test('the revision of what is shown matches the form the host derives', () => {
  assert.equal(fileRevision({ kind: 'text', revision: 'abc' }), 'abc');
  assert.equal(fileRevision({ kind: 'media', before: { revision: 'x' }, after: { revision: 'y' } }), 'media:x:y');
  assert.equal(fileRevision({ kind: 'media', before: null, after: { revision: 'y' } }), 'media::y');
  assert.equal(fileRevision({ kind: 'unavailable_lfs' }), 'lfs-unavailable');
  assert.equal(fileRevision({ kind: 'binary' }), 'binary');
  assert.equal(fileRevision({ kind: 'loading' }), null);
  assert.equal(fileRevision(null), null);
});

test('marks load with the comparison and count only reviewed files', async () => {
  const { progress } = await fixture({
    list: async () => [
      { path: 'a.rs', state: 'reviewed' },
      { path: 'b.rs', state: 'changed' },
    ],
    mark: async () => undefined,
  });
  try {
    assert.equal(progress.files.value.get('a.rs'), 'reviewed');
    assert.equal(progress.files.value.get('b.rs'), 'changed');
    assert.equal(progress.reviewedCount(), 1, 'a changed file is not counted');
  } finally {
    progress.stop();
  }
});

test('toggling marks the selected file with the revision shown, then clears it', async () => {
  const calls = [];
  const { state, progress, content } = await fixture({
    list: async () => [],
    mark: async (selection, revision, reviewed) => {
      calls.push({ path: selection.path, index: selection.index, revision, reviewed });
    },
  });
  try {
    await progress.toggleSelected();
    assert.deepEqual(calls, [], 'no file is selected yet');
    state.selected.value = 0;
    await progress.toggleSelected();
    assert.equal(progress.files.value.get('a.rs'), 'reviewed');
    assert.equal(progress.reviewedCount(), 1);
    content.value = { kind: 'text', revision: 'r-a2' };
    await progress.toggleSelected();
    assert.equal(progress.files.value.has('a.rs'), false, 'a reviewed file is cleared, whatever is shown');
    content.value = { kind: 'loading' };
    await progress.toggleSelected();
    assert.deepEqual(calls, [
      { path: 'a.rs', index: 0, revision: 'r-a', reviewed: true },
      { path: 'a.rs', index: 0, revision: 'r-a2', reviewed: false },
    ]);
  } finally {
    progress.stop();
  }
});

test('a changed file is reviewed again against what is shown now', async () => {
  const calls = [];
  const { state, progress } = await fixture({
    list: async () => [{ path: 'a.rs', state: 'changed' }],
    mark: async (_selection, revision, reviewed) => {
      calls.push({ revision, reviewed });
    },
  });
  try {
    state.selected.value = 0;
    await progress.toggleSelected();
    assert.deepEqual(calls, [{ revision: 'r-a', reviewed: true }]);
    assert.equal(progress.files.value.get('a.rs'), 'reviewed');
  } finally {
    progress.stop();
  }
});

test('a refused mark keeps the previous state and says why', async () => {
  const { state, progress } = await fixture({
    list: async () => [],
    mark: async () => {
      throw new Error('The file changed after it was opened.');
    },
  });
  try {
    state.selected.value = 0;
    await progress.toggleSelected();
    assert.equal(progress.files.value.size, 0);
    assert.match(progress.error.value, /changed after it was opened/u);
    assert.equal(progress.pending.value, false);
  } finally {
    progress.stop();
  }
});

test('a second press waits for the first and a comparison switch discards late marks', async () => {
  const gate = Promise.withResolvers();
  let marks = 0;
  const { state, progress } = await fixture({
    list: async (source) => (source.before === '/a' ? [{ path: 'b.rs', state: 'reviewed' }] : []),
    mark: async () => {
      marks += 1;
      await gate.promise;
    },
  });
  try {
    state.selected.value = 0;
    const first = progress.toggleSelected();
    await turn();
    assert.equal(progress.pending.value, true);
    await progress.toggleSelected();
    assert.equal(marks, 1);
    await state.open({ kind: 'paths', before: '/c', after: '/d' });
    await turn();
    gate.resolve();
    await first;
    assert.equal(progress.files.value.size, 0, 'the earlier comparison does not leak into the new one');
    assert.equal(progress.pending.value, false, 'the new comparison is not left busy');
  } finally {
    progress.stop();
  }
});

test('a failed load reports the error and an empty comparison asks nothing', async () => {
  let asked = 0;
  const failing = await fixture({
    list: async () => {
      asked += 1;
      throw new Error('The host is unavailable.');
    },
    mark: async () => undefined,
  });
  try {
    assert.match(failing.progress.error.value, /unavailable/u);
    assert.equal(failing.progress.files.value.size, 0);
  } finally {
    failing.progress.stop();
  }
  asked = 0;
  const empty = await fixture({ list: async () => ((asked += 1), []), mark: async () => undefined }, []);
  try {
    assert.equal(asked, 0);
  } finally {
    empty.progress.stop();
  }
});
