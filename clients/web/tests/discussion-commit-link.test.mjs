import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { createDiscussionState } from '../src/components/discussion/discussion-state.ts';
import { createReviewSourceState } from '../src/components/review/review-source.ts';

// HS2-B5K6GM: following a cited commit opens a new review and leaves the current one alone.
const path = 'src/bundle.ts';
const comparison = {
  identity: 'Fieldnotes',
  branch: null,
  comparison: 'Working tree',
  files: [{ path, previous_path: null, status: 'modified' }],
};
const anchor = { path, side: 'after', revision: 'file-revision', target: { kind: 'line', start: 3, end: 3 } };
const note = {
  id: 1,
  revision: 1,
  anchor,
  origin: {
    kind: 'ai',
    tags: ['Risk Analysis'],
    risk: null,
    related_locations: [{ path: 'old.ts', line: 7, revision: 'r', commit: 'abcdef1234' }],
  },
  opening: { author: 'AI note', markdown: 'See [the original](0).', attachments: [] },
  replies: [],
};
const commit = { kind: 'commit', directory: '/repo', commit: 'abcdef1234', path: 'old.ts', line: 7 };
const definition = {
  path: 'src/x.ts',
  side: 'after',
  revision: 'r',
  diff_revision: null,
  index: null,
  line: 2,
  text: 'x',
};

async function fixture(answer) {
  const source = createReviewSourceState(comparison, () => Promise.resolve(comparison));
  const state = createDiscussionState(source, () => Promise.resolve([note]));
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve(answer());
  };
  await source.open({ kind: 'paths', before: '/before', after: '/after' });
  source.selected.value = 0;
  await setTimeout(0);
  await state.showThread(1);
  return {
    state,
    requests,
    done() {
      globalThis.fetch = realFetch;
      state.stop();
    },
  };
}

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('a commit citation opens its target through the new-review callback and reveals nothing', async () => {
  const { state, requests, done } = await fixture(() => json(commit));
  try {
    const opened = [];
    const revealed = [];
    await state.openSourceLink(
      0,
      (destination) => {
        revealed.push(destination);
        return Promise.resolve();
      },
      (target) => {
        opened.push(target);
        return true;
      },
    );
    assert.deepEqual(
      requests.map(({ url }) => url),
      ['/api/v1/review/discussion/source-link'],
    );
    assert.equal(requests[0].body.index, 0);
    assert.deepEqual(opened, [commit]);
    assert.deepEqual(revealed, [], 'the current review is not navigated');
    assert.equal(state.error.value, '');
  } finally {
    done();
  }
});

test('a destination in the current review still reveals and never opens a new review', async () => {
  const { state, done } = await fixture(() => json(definition));
  try {
    const revealed = [];
    let opened = 0;
    await state.openSourceLink(
      0,
      (destination) => {
        revealed.push(destination);
        return Promise.resolve();
      },
      () => {
        opened += 1;
        return true;
      },
    );
    assert.deepEqual(revealed, [definition]);
    assert.equal(opened, 0);
  } finally {
    done();
  }
});

test('a blocked tab, a missing opener and a host refusal each say so in the inspector', async () => {
  const answers = [
    () => json(commit),
    () => json(commit),
    () => new Response('The cited commit is not available in this repository.', { status: 404 }),
  ];
  const { state, done } = await fixture(() => answers.shift()());
  try {
    const reveal = () => Promise.resolve();
    await state.openSourceLink(0, reveal, () => false);
    assert.match(state.error.value, /blocked the new review/u);
    await state.openSourceLink(0, reveal, undefined);
    assert.equal(state.error.value, 'A cited commit cannot be opened here.');
    let opened = 0;
    await state.openSourceLink(0, reveal, () => {
      opened += 1;
      return true;
    });
    assert.equal(state.error.value, 'The cited commit is not available in this repository.');
    assert.equal(opened, 0, 'nothing opens when the host refuses');
  } finally {
    done();
  }
});

test('a late answer for a thread that is no longer open opens nothing', async () => {
  const late = Promise.withResolvers();
  const { state, done } = await fixture(() => late.promise);
  try {
    let opened = 0;
    const pending = state.openSourceLink(
      0,
      () => Promise.resolve(),
      () => {
        opened += 1;
        return true;
      },
    );
    state.resetEditor();
    late.resolve(json(commit));
    await pending;
    assert.equal(opened, 0);
  } finally {
    done();
  }
});
