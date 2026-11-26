import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFindState,
  findMatches,
  findReadout,
  findResult,
  lineRanges,
  markTokens,
  resetFindOnChange,
  stepMatch,
} from '../src/components/diff/diff-find.ts';

// HS2-30ZEFE: Find within the lines the diff shows.
const line = (kind, before, after, text) => ({
  kind,
  before_line: before,
  after_line: after,
  text,
  ends_with_newline: true,
});
const hunk = (lines) => ({ kind: 'hunk', header: true, hunk: { lines } });
const context = (lines) => ({ kind: 'context', lines });
const blocks = [
  hunk([
    line('context', 10, 10, 'const Alpha = alpha();'),
    line('removed', 11, null, 'return old_value;'),
    line('added', null, 11, 'return new_value + old_value;'),
  ]),
  { kind: 'expand', gap: { index: 1 }, hidden: 40 },
  context([line('context', 60, 62, 'ALPHA at the revealed line')]),
];

test('matches ignore case, run in diff order and count a line once', () => {
  const matches = findMatches(blocks, 'alpha');
  assert.deepEqual(
    matches.map(({ before, after, start }) => [before, after, start]),
    [
      [10, 10, 6],
      [10, 10, 14],
      [60, 62, 0],
    ],
  );
  assert.deepEqual(
    findMatches(blocks, 'old_value').map(({ before, after }) => [before, after]),
    [
      [11, null],
      [null, 11],
    ],
  );
  assert.deepEqual(findMatches(blocks, ''), []);
  assert.deepEqual(findMatches(blocks, 'nothing like this'), []);
});

test('the query is plain text, not a pattern', () => {
  const special = [context([line('context', 1, 1, 'call(a.b) [x] $1 a+b? a.b')])];
  assert.equal(findMatches(special, 'a.b').length, 2);
  assert.equal(findMatches(special, '(a.b)').length, 1);
  assert.equal(findMatches(special, '$1').length, 1);
  assert.equal(findMatches(special, 'a+b?').length, 1);
  assert.equal(findMatches(special, '[x]').length, 1);
  assert.equal(findMatches(special, '.*').length, 0);
});

test('hidden lines are not searched until they are shown', () => {
  const hidden = [blocks[0], blocks[1]];
  assert.equal(findMatches(hidden, 'alpha').length, 2);
  assert.equal(findMatches(blocks, 'alpha').length, 3);
});

test('results keep the current match in range and read out as a count', () => {
  assert.equal(findResult(blocks, 'alpha', 7).current, 2);
  assert.equal(findResult(blocks, 'alpha', -3).current, 0);
  assert.equal(findReadout(findResult(blocks, 'alpha', 1)), '2 of 3');
  assert.equal(findReadout(findResult(blocks, 'zzz', 4)), 'No matches');
  assert.equal(findReadout(findResult(blocks, '', 0)), '');
  assert.equal(findResult(blocks, 'zzz', 4).current, 0);
});

test('stepping wraps at both ends and is safe with no matches', () => {
  assert.equal(stepMatch(3, 0, 1), 1);
  assert.equal(stepMatch(3, 2, 1), 0);
  assert.equal(stepMatch(3, 0, -1), 2);
  assert.equal(stepMatch(1, 0, 1), 0);
  assert.equal(stepMatch(0, 0, 1), 0);
  assert.equal(stepMatch(0, 0, -1), 0);
});

test('ranges for a line flag only the current match', () => {
  const result = findResult(blocks, 'alpha', 1);
  assert.deepEqual(lineRanges(result, { before_line: 10, after_line: 10 }), [
    { start: 6, length: 5, current: false },
    { start: 14, length: 5, current: true },
  ]);
  assert.deepEqual(lineRanges(result, { before_line: 11, after_line: null }), []);
});

test('marking splits syntax tokens at match edges and keeps every character', () => {
  const tokens = [
    { text: 'const', kind: 'keyword' },
    { text: ' Alpha = ', kind: 'plain' },
    { text: 'alpha', kind: 'symbol' },
  ];
  const marked = markTokens(tokens, [
    { start: 6, length: 5, current: false },
    { start: 14, length: 5, current: true },
  ]);
  assert.equal(marked.map(({ text }) => text).join(''), 'const Alpha = alpha');
  assert.deepEqual(
    marked.map(({ text, kind, mark }) => [text, kind, mark]),
    [
      ['const', 'keyword', null],
      [' ', 'plain', null],
      ['Alpha', 'plain', 'match'],
      [' = ', 'plain', null],
      ['alpha', 'symbol', 'current'],
    ],
  );
  const across = markTokens(tokens, [{ start: 3, length: 5, current: true }]);
  assert.deepEqual(
    across.map(({ text, mark }) => [text, mark]),
    [
      ['con', null],
      ['st', 'current'],
      [' Al', 'current'],
      ['pha = ', null],
      ['alpha', null],
    ],
  );
  assert.deepEqual(
    markTokens(tokens, []).map(({ mark }) => mark),
    [null, null, null],
  );
});

test('find state starts empty at the first match', () => {
  const state = createFindState();
  assert.equal(state.query.value, '');
  assert.equal(state.current.value, 0);
  assert.equal(state.open.value, false);
});

test('a new file keeps the query and returns to the first match', async () => {
  const { signal } = await import('kerfjs');
  const state = createFindState();
  const result = signal({ kind: 'loading' });
  const stop = resetFindOnChange(state, result);
  try {
    state.query.value = 'alpha';
    state.current.value = 2;
    result.value = { kind: 'text' };
    assert.equal(state.current.value, 0);
    assert.equal(state.query.value, 'alpha');
    state.current.value = 1;
    assert.equal(state.current.value, 1, 'stepping alone is not a file change');
  } finally {
    stop();
  }
});
