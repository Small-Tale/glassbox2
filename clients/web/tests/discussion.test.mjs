import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { createDiscussionState, sourceLinkParts } from '../src/components/discussion/discussion-state.ts';
import { createReviewSourceState } from '../src/components/review/review-source.ts';

test('AI source links preserve indices and render unusable references literally', () => {
  const path = { path: 'src.ts', line: 1, revision: 'revision' };
  const text = 'See [missing](1), [known](2), and [invalid](20).';
  assert.deepEqual(sourceLinkParts(text, [path, null, path]), [
    'See [missing](1), ',
    { label: 'known', index: 2 },
    ', and [invalid](20).',
  ]);
  assert.deepEqual(sourceLinkParts(text, []), [text]);
});
const path = 'src/bundle.ts';
const comparison = {
  identity: 'Fieldnotes',
  branch: null,
  comparison: 'Working tree',
  files: [{ path, previous_path: null, status: 'modified' }],
};
const anchor = { path, side: 'after', revision: 'file-revision', target: { kind: 'line', start: 23, end: 23 } };

function thread(id, markdown) {
  return {
    id,
    anchor,
    revision: 1,
    origin: { kind: 'reviewer', category: 'note' },
    opening: { author: 'Reviewer', markdown, attachments: [] },
    replies: [],
  };
}

test('switching threads waits for an in-flight edit and keeps their content independent', async () => {
  const source = createReviewSourceState(comparison, () => Promise.resolve(comparison));
  const first = thread(1, 'First draft');
  const second = thread(2, 'Second comment');
  const edit = Promise.withResolvers();
  const requests = [];
  const state = createDiscussionState(source, (selection, operation) => {
    requests.push({ selection, operation });
    return operation === undefined ? Promise.resolve([first, second]) : edit.promise;
  });

  try {
    await source.open({ kind: 'paths', before: '/before', after: '/after' });
    source.selected.value = 0;
    await setTimeout(0);
    await state.showThread(1);
    state.edit('Edited draft');
    const save = state.saveEdit();
    const switchThread = state.showThread(2);
    assert.equal(state.threadId.value, 1);
    assert.equal(requests[1].operation.id, 1);
    assert.equal(requests[1].operation.revision, 1);
    edit.resolve([{ ...first, revision: 2, opening: { ...first.opening, markdown: 'Edited draft' } }, second]);
    await save;
    await switchThread;
    assert.equal(state.threadId.value, 2);
    assert.equal(state.text.value, 'Second comment');
    await state.showThread(1);
    assert.equal(state.text.value, 'Edited draft');
    assert.equal(requests.length, 2);
  } finally {
    state.stop();
  }
});

async function openedState(operations) {
  const source = createReviewSourceState(comparison, () => Promise.resolve(comparison));
  const first = thread(1, 'First draft');
  const second = thread(2, 'Second comment');
  const state = createDiscussionState(source, (selection, operation) => {
    if (operation === undefined) return Promise.resolve([first, second]);
    operations.push(operation);
    return Promise.resolve([
      { ...first, revision: first.revision + 1, opening: { ...first.opening, markdown: operation.change.markdown } },
      second,
    ]);
  });
  await source.open({ kind: 'paths', before: '/before', after: '/after' });
  source.selected.value = 0;
  await setTimeout(0);
  await state.showThread(1);
  return { state, source };
}

test('HS2-9RWAAQ rapid edits save once, 350 ms after the last edit, with the latest text', async () => {
  const operations = [];
  const { state } = await openedState(operations);
  try {
    state.edit('a');
    await setTimeout(200);
    state.edit('ab');
    await setTimeout(200);
    assert.equal(operations.length, 0, 'the second edit restarted the quiet window');
    state.edit('abc');
    await setTimeout(450);
    assert.equal(operations.length, 1);
    assert.equal(operations[0].change.markdown, 'abc');
    assert.equal(state.threadId.value, 1);
  } finally {
    state.stop();
  }
});

test('HS2-9RWAAQ an explicit save or a thread switch cancels the pending autosave', async () => {
  const operations = [];
  const { state } = await openedState(operations);
  try {
    state.edit('explicit');
    assert.equal(await state.saveEdit(), true);
    assert.equal(operations.length, 1);
    await setTimeout(450);
    assert.equal(operations.length, 1, 'the pending autosave did not repeat the save');

    state.edit('explicit again');
    await state.showThread(2);
    assert.equal(operations.length, 2);
    await setTimeout(450);
    assert.equal(operations.length, 2, 'switching threads saved once and left nothing pending');

    state.resetEditor();
    state.edit('without a thread');
    await setTimeout(450);
    assert.equal(operations.length, 2, 'an edit with no open thread never autosaves');
  } finally {
    state.stop();
  }
});
