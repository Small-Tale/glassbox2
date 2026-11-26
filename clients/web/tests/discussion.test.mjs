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

// HS2-TGAGQ4: Move Comment keeps the thread and only leaves the form when the host accepts the destination.
async function moveFixture(respond) {
  const source = createReviewSourceState(comparison, () => Promise.resolve(comparison));
  const first = thread(1, 'Check this.');
  const requests = [];
  const state = createDiscussionState(source, (selection, operation) => {
    requests.push(operation);
    return operation === undefined ? Promise.resolve([first]) : respond(operation, first);
  });
  await source.open({ kind: 'paths', before: '/before', after: '/after' });
  source.selected.value = 0;
  await setTimeout(0);
  await state.showThread(1);
  return { state, requests, first };
}

const anchorFor = (side, line) => ({ ...anchor, side, target: { kind: 'line', start: line, end: line } });

test('HS2-TGAGQ4 moving sends the thread revision and the destination, then closes the form', async () => {
  const { state, requests, first } = await moveFixture((operation) =>
    Promise.resolve([{ ...first_(operation), revision: 2 }]),
  );
  function first_(operation) {
    return { ...thread(1, 'Check this.'), anchor: operation.anchor };
  }
  try {
    state.startMove();
    assert.deepEqual(state.moving.value, { side: 'after', line: '23' });
    state.editMove({ side: 'before', line: '9' });
    assert.equal(await state.submitMove(anchorFor), true);
    const sent = requests.at(-1);
    assert.deepEqual(
      { kind: sent.kind, id: sent.id, revision: sent.revision, side: sent.anchor.side, line: sent.anchor.target.start },
      { kind: 'move', id: first.id, revision: 1, side: 'before', line: 9 },
    );
    assert.equal(state.moving.value, null);
    assert.equal(state.activeThread().anchor.target.start, 9);
    assert.equal(state.activeThread().revision, 2);
  } finally {
    state.stop();
  }
});

test('HS2-TGAGQ4 cancel leaves the thread alone and a refused destination keeps the form open', async () => {
  const { state, requests } = await moveFixture(() =>
    Promise.reject(new Error('The selected line has changed. Reopen the file before moving the comment.')),
  );
  try {
    state.startMove();
    state.cancelMove();
    assert.equal(state.moving.value, null);
    assert.equal(requests.filter((operation) => operation?.kind === 'move').length, 0);

    state.startMove();
    state.editMove({ line: '400' });
    assert.equal(await state.submitMove(anchorFor), false);
    assert.deepEqual(state.moving.value, { side: 'after', line: '400' }, 'the form stays for another try');
    assert.match(state.error.value, /has changed/u);
    assert.equal(state.activeThread().anchor.target.start, 23);
    assert.equal(state.pending.value, false);
  } finally {
    state.stop();
  }
});

test('HS2-TGAGQ4 a bad line number or a missing file asks nothing of the host', async () => {
  const { state, requests } = await moveFixture(() => Promise.resolve([]));
  try {
    state.startMove();
    for (const line of ['', '0', '-3', '2.5', 'abc']) {
      state.editMove({ line });
      assert.equal(await state.submitMove(anchorFor), false, line);
      assert.match(state.error.value, /line/u);
    }
    state.editMove({ line: '5' });
    assert.equal(await state.submitMove(() => undefined), false);
    assert.match(state.error.value, /file/u);
    assert.equal(requests.filter((operation) => operation?.kind === 'move').length, 0);
    state.resetEditor();
    assert.equal(state.moving.value, null, 'closing the thread closes the form');
  } finally {
    state.stop();
  }
});

test('HS2-TGAGQ4 only a line thread can start a move', async () => {
  const region = {
    ...thread(1, 'Region.'),
    anchor: { ...anchor, target: { kind: 'image_region', left: 0, top: 0, width: 1, height: 1 } },
  };
  const source = createReviewSourceState(comparison, () => Promise.resolve(comparison));
  const state = createDiscussionState(source, () => Promise.resolve([region]));
  try {
    await source.open({ kind: 'paths', before: '/before', after: '/after' });
    source.selected.value = 0;
    await setTimeout(0);
    await state.showThread(1);
    state.startMove();
    assert.equal(state.moving.value, null);
  } finally {
    state.stop();
  }
});

// HS2-RV5BD8: a stale thread asks the host for a new line, and only a confirmed unique match moves it.
async function relocationFixture(
  answer,
  respond = (operation, first) => Promise.resolve([{ ...first, anchor: operation.anchor }]),
) {
  const source = createReviewSourceState(comparison, () => Promise.resolve(comparison));
  const first = thread(1, 'Check this.');
  const requests = [];
  const asked = [];
  const state = createDiscussionState(
    source,
    (selection, operation) => {
      requests.push(operation);
      return operation === undefined ? Promise.resolve([first]) : respond(operation, first);
    },
    (selection, id) => {
      asked.push({ index: selection.index, path: selection.path, id });
      return typeof answer === 'function' ? answer() : Promise.resolve(answer);
    },
  );
  await source.open({ kind: 'paths', before: '/before', after: '/after' });
  source.selected.value = 0;
  await setTimeout(0);
  await state.showThread(1);
  return { state, requests, asked };
}

test('HS2-RV5BD8 a unique match is offered and moving it sends the matched text as a guard', async () => {
  const { state, requests, asked } = await relocationFixture({
    outcome: 'suggestion',
    side: 'after',
    line: 31,
    text: 'const value = 1;',
  });
  try {
    await state.suggestRelocation();
    assert.deepEqual(asked, [{ index: 0, path, id: 1 }]);
    assert.equal(state.relocation.value.line, 31);
    assert.equal(requests.filter((operation) => operation?.kind === 'move').length, 0, 'asking changes nothing');
    assert.equal(await state.confirmRelocation(anchorFor), true);
    const sent = requests.at(-1);
    assert.deepEqual(
      { kind: sent.kind, id: sent.id, revision: sent.revision, line: sent.anchor.target.start, if_text: sent.if_text },
      { kind: 'move', id: 1, revision: 1, line: 31, if_text: 'const value = 1;' },
    );
    assert.equal(state.relocation.value, null);
    assert.equal(state.activeThread().anchor.target.start, 31);
  } finally {
    state.stop();
  }
});

test('HS2-RV5BD8 dismissing, or any answer without a suggestion, leaves the thread stale', async () => {
  for (const outcome of ['ambiguous', 'missing', 'hidden', 'unavailable']) {
    const { state, requests } = await relocationFixture({ outcome });
    try {
      await state.suggestRelocation();
      assert.equal(state.relocation.value.outcome, outcome);
      assert.equal(await state.confirmRelocation(anchorFor), false, `${outcome} cannot be confirmed`);
      assert.equal(requests.filter((operation) => operation?.kind === 'move').length, 0);
      state.dismissRelocation();
      assert.equal(state.relocation.value, null);
      assert.equal(state.activeThread().anchor.target.start, 23);
    } finally {
      state.stop();
    }
  }
  const { state } = await relocationFixture({ outcome: 'suggestion', side: 'after', line: 5, text: 'x' });
  try {
    await state.suggestRelocation();
    state.dismissRelocation();
    assert.equal(state.relocation.value, null);
    assert.equal(await state.confirmRelocation(anchorFor), false, 'a dismissed suggestion cannot be confirmed');
  } finally {
    state.stop();
  }
});

test('HS2-RV5BD8 a destination that changed again is refused and the thread stays put', async () => {
  const { state } = await relocationFixture(
    { outcome: 'suggestion', side: 'after', line: 31, text: 'const value = 1;' },
    () => Promise.reject(new Error('The suggested line has changed. Ask for a new suggestion.')),
  );
  try {
    await state.suggestRelocation();
    assert.equal(await state.confirmRelocation(anchorFor), false);
    assert.match(state.error.value, /suggested line has changed/u);
    assert.equal(state.relocation.value, null, 'the stale suggestion is dropped');
    assert.equal(state.activeThread().anchor.target.start, 23);
    assert.equal(state.pending.value, false);
  } finally {
    state.stop();
  }
});

test('HS2-RV5BD8 a late answer for another thread or a failed request is not shown', async () => {
  const gate = Promise.withResolvers();
  const { state } = await relocationFixture(() => gate.promise);
  try {
    const asking = state.suggestRelocation();
    assert.equal(state.relocation.value, 'asking');
    state.resetEditor();
    gate.resolve({ outcome: 'suggestion', side: 'after', line: 9, text: 'x' });
    await asking;
    assert.equal(state.relocation.value, null, 'closing the thread discards the answer');
  } finally {
    state.stop();
  }
  const failing = await relocationFixture(() => Promise.reject(new Error('The host is unavailable.')));
  try {
    await failing.state.suggestRelocation();
    assert.equal(failing.state.relocation.value, null);
    assert.match(failing.state.error.value, /unavailable/u);
  } finally {
    failing.state.stop();
  }
});
