import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import {
  createContextExpansion,
  resetContextOnChange,
  contextStep,
  diffBlocks,
  gapsOf,
  hiddenLines,
  nextRange,
  noExpansion,
  withRevealed,
} from '../src/components/diff/context-expansion.ts';
import { selectedDiff } from '../src/components/diff/selected-diff.ts';
import { createReviewSourceState } from '../src/components/review/review-source.ts';

// HS2-DZ8ZR6: unchanged context between hunks and toward the file's ends.
const line = (kind, before, after, text = `line ${after ?? before}`) => ({
  kind,
  before_line: before,
  after_line: after,
  text,
  ends_with_newline: true,
});
const hunk = (before_start, before_count, after_start, after_count, lines) => ({
  before_start,
  before_count,
  after_start,
  after_count,
  lines,
});
// Lines 8-12 of a 100-line file gain one line, then lines 60-62 change; the gap shifts numbering by one.
const first = hunk(8, 3, 8, 4, [
  line('context', 8, 8),
  line('added', null, 9),
  line('context', 9, 10),
  line('context', 10, 11),
]);
const second = hunk(60, 3, 61, 3, [
  line('context', 60, 61),
  line('removed', 61, null),
  line('added', null, 62),
  line('context', 62, 63),
]);
const total = 101;
const fetched = (start, end) =>
  Array.from({ length: end - start + 1 }, (_, offset) => ({ text: `line ${start + offset}`, ends_with_newline: true }));

test('gaps cover the head, the middle and the tail with the numbering shift between hunks', () => {
  const gaps = gapsOf([first, second], total);
  assert.deepEqual(
    gaps.map(({ index, start, end, delta, hasAbove, hasBelow }) => ({ index, start, end, delta, hasAbove, hasBelow })),
    [
      { index: 0, start: 1, end: 7, delta: 0, hasAbove: true, hasBelow: false },
      { index: 1, start: 12, end: 60, delta: -1, hasAbove: true, hasBelow: true },
      { index: 2, start: 64, end: 101, delta: -1, hasAbove: false, hasBelow: true },
    ],
  );
  assert.deepEqual(
    gapsOf([first, second], null).map(({ index }) => index),
    [0, 1],
    'no tail without a line count',
  );
  assert.deepEqual(gapsOf([hunk(1, 2, 1, 2, [])], 2), [], 'a hunk that spans the file leaves nothing hidden');
});

test('a zero-length side counts from the line before it', () => {
  const added = hunk(0, 0, 1, 3, []);
  assert.deepEqual(
    gapsOf([added], 10).map(({ index, start, end }) => ({ index, start, end })),
    [{ index: 1, start: 4, end: 10 }],
  );
  const deleted = hunk(5, 2, 4, 0, []);
  const [head, tail] = gapsOf([deleted], 9);
  assert.deepEqual([head.start, head.end, tail.start, tail.end, tail.delta], [1, 4, 5, 9, 2]);
});

test('ranges grow from each edge and stop when nothing is hidden', () => {
  const [head, middle, tail] = gapsOf([first, second], total);
  assert.deepEqual(nextRange(middle, { top: 0, bottom: 0 }, 'below'), { start: 12, end: 31 });
  assert.deepEqual(nextRange(middle, { top: 0, bottom: 0 }, 'above'), { start: 41, end: 60 });
  assert.deepEqual(nextRange(middle, { top: 20, bottom: 25 }, 'below'), { start: 32, end: 35 });
  assert.deepEqual(nextRange(middle, { top: 20, bottom: 25 }, 'above'), { start: 32, end: 35 });
  assert.deepEqual(nextRange(middle, { top: 20, bottom: 25 }, 'all'), { start: 32, end: 35 });
  assert.equal(nextRange(middle, { top: 30, bottom: 19 }, 'below'), null);
  assert.equal(nextRange(head, { top: 0, bottom: 0 }, 'below'), null, 'the head has no hunk above it');
  assert.equal(nextRange(tail, { top: 0, bottom: 0 }, 'above'), null, 'the tail has no hunk below it');
  assert.deepEqual(nextRange(tail, { top: 0, bottom: 0 }, 'below'), { start: 64, end: 83 });
  assert.deepEqual(nextRange(tail, { top: 0, bottom: 0 }, 'all'), { start: 64, end: 101 });
  const [long] = gapsOf([hunk(1000, 1, 1000, 1, [])], 2000);
  assert.equal(nextRange(long, { top: 0, bottom: 0 }, 'all'), null, 'one request cannot return more than the limit');
  assert.deepEqual(nextRange(long, { top: 0, bottom: 0 }, 'above'), { start: 980, end: 999 });
});

test('repeated expansion accumulates, merges the hunks and drops the header', () => {
  const gaps = gapsOf([first, second], total);
  const middle = gaps[1];
  let expansion = noExpansion;
  const initial = diffBlocks([first, second], total, expansion);
  assert.deepEqual(
    initial.map(({ kind }) => kind),
    ['expand', 'hunk', 'expand', 'hunk', 'expand'],
  );
  assert.ok(initial.filter(({ kind }) => kind === 'hunk').every(({ header }) => header));

  expansion = withRevealed(expansion, middle, 'below', { start: 12, end: 31 }, fetched(12, 31));
  expansion = withRevealed(expansion, middle, 'above', { start: 41, end: 60 }, fetched(41, 60));
  const partial = diffBlocks([first, second], total, expansion);
  assert.deepEqual(
    partial.map(({ kind }) => kind),
    ['expand', 'hunk', 'context', 'expand', 'context', 'hunk', 'expand'],
  );
  const below = partial[2];
  assert.deepEqual(
    [below.lines[0].before_line, below.lines[0].after_line],
    [11, 12],
    'before numbers follow the shift',
  );
  assert.equal(partial[3].hidden, 9);
  assert.equal(partial[5].header, false, 'revealed lines now touch the next hunk');
  assert.equal(partial[1].header, true);

  expansion = withRevealed(expansion, middle, 'all', { start: 32, end: 40 }, fetched(32, 40));
  const merged = diffBlocks([first, second], total, expansion);
  assert.equal(hiddenLines(middle, expansion.reach.get(1)), 0);
  assert.deepEqual(
    merged.map(({ kind }) => kind),
    ['expand', 'hunk', 'context', 'context', 'hunk', 'expand'],
  );
  assert.equal(merged.at(-2).header, false);
  const numbers = merged.flatMap((block) =>
    block.kind === 'context' ? block.lines.map((entry) => entry.after_line) : [],
  );
  assert.deepEqual(
    numbers,
    Array.from({ length: 49 }, (_, index) => index + 12),
  );
});

function sourceFixture() {
  return createReviewSourceState(undefined, async () => ({
    identity: 'working',
    branch: null,
    comparison: 'Direct comparison',
    files: [
      { path: 'a.rs', status: 'modified', previous_path: null },
      { path: 'b.rs', status: 'modified', previous_path: null },
    ],
  }));
}

const content = { kind: 'text', revision: 'r1', hunks: [first, second], after_lines: total };
const turn = () => setImmediate();

async function readerFixture(loadContext, loaded = content) {
  const state = sourceFixture();
  await state.open({ kind: 'paths', before: '/a', after: '/b' });
  const reader = selectedDiff(state, async ({ index }) => (index === 0 ? loaded : { ...loaded, revision: 'r2' }));
  const selection = () => {
    const index = state.selected.value;
    return index === undefined ? null : { source: state.activeSource.value, index, path: `f${index}.rs` };
  };
  const context = createContextExpansion(reader.result, selection, loadContext);
  const stopReset = resetContextOnChange(context, reader.result);
  return {
    state,
    reader,
    context,
    stop() {
      stopReset();
      reader.stop();
    },
  };
}

test('expansion fetches bounded lines for its revision and tracks pending and failure', async () => {
  const requests = [];
  const gate = [];
  const { state, context, stop } = await readerFixture((selection, revision, range) => {
    requests.push({ index: selection.index, revision, ...range });
    const pending = Promise.withResolvers();
    gate.push(pending);
    return pending.promise;
  });
  try {
    state.selected.value = 0;
    await turn();
    const firstPress = context.expand(1, 'below');
    await turn();
    assert.equal(context.expansion.value.pending, 1);
    await context.expand(1, 'above');
    assert.equal(requests.length, 1, 'a second control press waits for the first fetch');
    gate[0].resolve({ lines: fetched(12, 31), total });
    await firstPress;
    assert.deepEqual(requests, [{ index: 0, revision: 'r1', start: 12, end: 31 }]);
    assert.equal(context.expansion.value.pending, null);
    assert.equal(context.expansion.value.lines.size, contextStep);

    const failing = context.expand(1, 'above');
    await turn();
    gate[1].reject(new Error('The file changed after it was opened. Open the comparison again.'));
    await failing;
    assert.match(context.expansion.value.error.message, /changed after it was opened/u);
    assert.equal(context.expansion.value.lines.size, contextStep, 'a failed fetch keeps what was shown');
    assert.equal(context.expansion.value.pending, null);

    const retry = context.expand(1, 'above');
    await turn();
    assert.equal(context.expansion.value.error, null);
    gate[2].resolve({ lines: fetched(41, 60), total });
    await retry;
    assert.deepEqual(context.expansion.value.reach.get(1), { top: 20, bottom: 20 });
  } finally {
    stop();
  }
});

test('a source change during a fetch discards its lines and resets expansion with the file', async () => {
  const pending = Promise.withResolvers();
  const { state, reader, context, stop } = await readerFixture(() => pending.promise);
  try {
    state.selected.value = 0;
    await turn();
    const request = context.expand(1, 'below');
    await turn();
    state.selected.value = 1;
    await turn();
    pending.resolve({ lines: fetched(12, 31), total });
    await request;
    assert.equal(context.expansion.value.lines.size, 0);
    assert.equal(context.expansion.value.pending, null);
    assert.equal(reader.result.value.revision, 'r2');
    state.selected.value = 0;
    await turn();
    assert.equal(context.expansion.value.reach.size, 0, 'returning to a file starts collapsed again');
  } finally {
    stop();
  }
});

test('expanding a gap that does not exist does nothing', async () => {
  let calls = 0;
  const { state, context, stop } = await readerFixture(
    async () => {
      calls += 1;
      return { lines: [], total };
    },
    { ...content, after_lines: null },
  );
  try {
    state.selected.value = 0;
    await turn();
    await context.expand(2, 'below');
    await context.expand(9, 'all');
    assert.equal(calls, 0);
  } finally {
    stop();
  }
});
