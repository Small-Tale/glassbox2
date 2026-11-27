import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { createDiscussionState } from '../src/components/discussion/discussion-state.ts';
import { createReviewSourceState } from '../src/components/review/review-source.ts';

// HS2-3G613V: previews load only for attachments the host verified, belong to the open thread, and are
// released with it.
const path = 'src/bundle.ts';
const comparison = {
  identity: 'Fieldnotes',
  branch: null,
  comparison: 'Working tree',
  files: [{ path, previous_path: null, status: 'modified' }],
};
const anchor = { path, side: 'after', revision: 'file-revision', target: { kind: 'line', start: 3, end: 3 } };

function thread(id, attachments) {
  return {
    id,
    anchor,
    revision: 1,
    origin: { kind: 'reviewer', category: 'note' },
    opening: { author: 'Reviewer', markdown: `Thread ${id}`, attachments },
    replies: [],
  };
}

const image = { id: 10, filename: 'shot.png', preview: 'image', openable: true };
const document = { id: 11, filename: 'notes.pdf', preview: 'pdf', openable: true };
const unlisted = { id: 12, filename: 'logs.zip', openable: false };

async function fixture(options = {}) {
  const source = createReviewSourceState(comparison, () => Promise.resolve(comparison));
  const threads = options.threads ?? [thread(1, [image, document, unlisted]), thread(2, [{ ...image, id: 20 }])];
  const previews = [];
  const opens = [];
  const revoked = [];
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = (url) => {
    revoked.push(url);
    revoke(url);
  };
  const api = {
    preview:
      options.preview ??
      ((_selection, threadId, attachment) => {
        previews.push({ threadId, attachment });
        return Promise.resolve(new Blob([`bytes-${attachment}`], { type: 'image/png' }));
      }),
    open:
      options.open ??
      ((_selection, threadId, attachment) => {
        opens.push({ threadId, attachment });
        return Promise.resolve(200);
      }),
  };
  const state = createDiscussionState(source, () => Promise.resolve(threads), undefined, api);
  await source.open({ kind: 'paths', before: '/before', after: '/after' });
  source.selected.value = 0;
  await setTimeout(0);
  return {
    state,
    previews,
    opens,
    revoked,
    done() {
      state.stop();
      URL.revokeObjectURL = revoke;
    },
  };
}

const ready = (state, id) => {
  const entry = state.attachmentPreviews.value[id];
  return entry?.status === 'ready' ? entry.url : undefined;
};

test('opening a thread loads thumbnails for verified images only', async () => {
  const { state, previews, done } = await fixture();
  try {
    await state.showThread(1);
    await setTimeout(0);
    assert.deepEqual(previews, [{ threadId: 1, attachment: 10 }], 'no PDF or unverified attachment is fetched');
    assert.match(ready(state, 10) ?? '', /^blob:/u);
    assert.equal(state.attachmentPreviews.value[11], undefined);
    assert.equal(state.attachmentPreviews.value[12], undefined);
    await state.showThread(1);
    await setTimeout(0);
    assert.equal(previews.length, 1, 'showing the same thread again does not fetch again');
  } finally {
    done();
  }
});

test('enlarging toggles, and a PDF loads only when first opened', async () => {
  const { state, previews, done } = await fixture();
  try {
    await state.showThread(1);
    await setTimeout(0);
    state.toggleAttachment(10);
    assert.equal(state.expandedAttachment.value, 10);
    state.toggleAttachment(10);
    assert.equal(state.expandedAttachment.value, null, 'the same control collapses it');
    assert.equal(previews.length, 1, 'an image is not refetched');

    state.toggleAttachment(11);
    await setTimeout(0);
    assert.equal(state.expandedAttachment.value, 11);
    assert.deepEqual(
      previews.map(({ attachment }) => attachment),
      [10, 11],
    );
    assert.match(ready(state, 11) ?? '', /^blob:/u);
    state.toggleAttachment(11);
    state.toggleAttachment(11);
    await setTimeout(0);
    assert.equal(previews.length, 2, 'a loaded PDF is not fetched again');
    state.toggleAttachment(10);
    assert.equal(state.expandedAttachment.value, 10, 'opening another one replaces the expanded one');
  } finally {
    done();
  }
});

test('switching threads releases the previous thread previews and loads the next', async () => {
  const { state, previews, revoked, done } = await fixture();
  try {
    await state.showThread(1);
    await setTimeout(0);
    const first = ready(state, 10);
    state.toggleAttachment(10);
    await state.showThread(2);
    await setTimeout(0);
    assert.deepEqual(revoked, [first], 'the first thread blob was released');
    assert.equal(state.attachmentPreviews.value[10], undefined);
    assert.equal(state.expandedAttachment.value, null, 'the expanded preview closes with its thread');
    assert.match(ready(state, 20) ?? '', /^blob:/u);
    assert.deepEqual(previews.at(-1), { threadId: 2, attachment: 20 });

    state.resetEditor();
    assert.deepEqual(state.attachmentPreviews.value, {});
    assert.equal(revoked.length, 2, 'closing the thread releases its blob too');
  } finally {
    done();
  }
});

test('a failed or late preview shows a message or is dropped', async () => {
  const late = Promise.withResolvers();
  let calls = 0;
  const { state, done } = await fixture({
    preview: (_selection, _thread, attachment, abort) => {
      calls += 1;
      if (calls === 1) return late.promise.then(() => new Blob(['late'], { type: 'image/png' }));
      assert.equal(abort.aborted, false);
      return Promise.reject(new Error(`no preview for ${attachment}`));
    },
  });
  try {
    await state.showThread(1);
    await setTimeout(0);
    assert.equal(state.attachmentPreviews.value[10]?.status, 'loading');
    await state.showThread(2);
    await setTimeout(0);
    late.resolve();
    await setTimeout(0);
    assert.equal(state.attachmentPreviews.value[10], undefined, 'a response for a closed thread is dropped');
    assert.equal(state.attachmentPreviews.value[20]?.status, 'failed');
    assert.match(state.attachmentPreviews.value[20].message, /could not be previewed/u);
  } finally {
    done();
  }
});

test('open reports the host answer and clears when the thread changes', async () => {
  const answers = [200, 415, 500];
  const { state, opens, done } = await fixture({
    open: (_selection, threadId, attachment) => {
      opens.push({ threadId, attachment });
      return Promise.resolve(answers.shift() ?? 200);
    },
  });
  try {
    await state.openAttachment(10);
    assert.deepEqual(opens, [], 'nothing opens without an open thread');
    await state.showThread(1);
    await setTimeout(0);
    await state.openAttachment(10);
    assert.equal(state.attachmentStatus.value, 'Opened in the default application.');
    await state.openAttachment(10);
    assert.equal(state.attachmentStatus.value, 'This attachment cannot be opened.');
    await state.openAttachment(10);
    assert.equal(state.attachmentStatus.value, 'Could not open the attachment.');
    assert.deepEqual(opens, [
      { threadId: 1, attachment: 10 },
      { threadId: 1, attachment: 10 },
      { threadId: 1, attachment: 10 },
    ]);
    await state.showThread(2);
    await setTimeout(0);
    assert.equal(state.attachmentStatus.value, '', 'the message belongs to the thread it was about');
  } finally {
    done();
  }
});

test('stopping the state releases every preview', async () => {
  const { state, revoked, done } = await fixture();
  try {
    await state.showThread(1);
    await setTimeout(0);
    const url = ready(state, 10);
    state.stop();
    assert.deepEqual(revoked, [url]);
    assert.deepEqual(state.attachmentPreviews.value, {});
  } finally {
    done();
  }
});
