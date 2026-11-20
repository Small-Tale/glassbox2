import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { createDiscussionState } from '../src/components/discussion/discussion-state.ts';
import { createReviewSourceState } from '../src/components/review/review-source.ts';

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
