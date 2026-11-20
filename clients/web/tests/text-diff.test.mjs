import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { selectedDiff } from '../src/components/diff/selected-diff.ts';
import { splitLines, syntaxTokens } from '../src/components/diff/text-diff-model.ts';
import { createReviewSourceState } from '../src/components/review/review-source.ts';

test('split rows preserve context and pad unequal changes without moving anchors', () => {
  const first = { kind: 'context', before_line: 1, after_line: 1 };
  const old = { kind: 'removed', before_line: 2, after_line: null };
  const newFirst = { kind: 'added', before_line: null, after_line: 2 };
  const newSecond = { kind: 'added', before_line: null, after_line: 3 };
  const last = { kind: 'context', before_line: 3, after_line: 4 };
  assert.deepEqual(splitLines([first, old, newFirst, newSecond, last]), [
    { before: first, after: first },
    { before: old, after: newFirst },
    { before: undefined, after: newSecond },
    { before: last, after: last },
  ]);
  assert.deepEqual(splitLines([old]), [{ before: old, after: undefined }]);
  assert.deepEqual(splitLines([]), []);
});

test('syntax cues preserve all characters and leave plain files untouched', () => {
  const text = '  const value = "literal // comment"; // real comment';
  const tokens = syntaxTokens(text, 'app.ts');
  assert.equal(tokens.map(({ text }) => text).join(''), text);
  assert.deepEqual(
    tokens.filter(({ kind }) => kind !== 'plain').map(({ kind }) => kind),
    ['keyword', 'string', 'comment'],
  );
  assert.deepEqual(syntaxTokens(text, 'README.md'), [{ text, kind: 'plain' }]);
});

test('a superseded file request cannot replace the current selection', async () => {
  const before = Promise.withResolvers();
  const after = Promise.withResolvers();
  const state = createReviewSourceState(undefined, async () => ({
    identity: 'working',
    branch: null,
    comparison: 'Direct comparison',
    files: [
      { path: 'before.rs', status: 'modified', previous_path: null },
      { path: 'after.rs', status: 'modified', previous_path: null },
    ],
  }));
  await state.open({ kind: 'paths', before: '/a', after: '/b' });
  const reader = selectedDiff(state, ({ index }) => (index === 0 ? before.promise : after.promise));
  try {
    state.selected.value = 0;
    await setImmediate();
    state.selected.value = 1;
    await setImmediate();
    after.resolve({ kind: 'text', hunks: [] });
    await turn();
    before.resolve({ kind: 'binary' });
    await turn();
    assert.deepEqual(reader.result.value, { kind: 'text', hunks: [] });
  } finally {
    reader.stop();
  }
});

function turn() {
  return setImmediate();
}

test('HS2-RVP90A keeps normal-size Lucide layout actions and Wrap in separate groups', async () => {
  const source = await readFile(new URL('../src/components/diff/text-diff.tsx', import.meta.url), 'utf8');
  const groups = [...source.matchAll(/<ToolbarControlGroup[^>]*>([\s\S]*?)<\/ToolbarControlGroup>/g)];
  assert.equal(groups.length, 2);
  assert.match(groups[0][1], /ariaLabel="Side by Side"/);
  assert.match(groups[0][1], /ariaLabel="Inline"/);
  assert.match(groups[1][1], /ariaLabel="Wrap"/);
  assert.doesNotMatch(groups[0][1], /ariaLabel="Wrap"/);
  assert.doesNotMatch(source, /size="compact"/);
  assert.equal([...source.matchAll(/icon=\{<LucideIcon/g)].length, 3);
});

test('media selection fetches the exact side revision and releases its object URL on navigation', async (context) => {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, selection: JSON.parse(options.body), signal: options.signal });
    return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
  });
  const state = createReviewSourceState(undefined, async () => ({
    identity: 'working',
    branch: null,
    comparison: 'Direct comparison',
    files: [
      { path: 'mark.svg', status: 'added', previous_path: null },
      { path: 'index.txt', status: 'modified', previous_path: null },
    ],
  }));
  const source = { kind: 'paths', before: '/a', after: '/b' };
  await state.open(source);
  const reader = selectedDiff(state, async ({ index }) =>
    index === 0
      ? { kind: 'media', before: null, after: { content_type: 'image/svg+xml', size: 6, revision: 'abc' } }
      : { kind: 'text', hunks: [] },
  );
  try {
    state.selected.value = 0;
    await turn();
    assert.equal(reader.result.value.kind, 'media');
    assert.equal(reader.result.value.before, null);
    assert.equal(reader.result.value.after.source, '<svg/>');
    const url = reader.result.value.after.url;
    assert(resolveObjectURL(url) instanceof Blob);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/v1/review/media');
    assert.deepEqual(requests[0].selection, { source, index: 0, path: 'mark.svg', side: 'after', revision: 'abc' });
    state.selected.value = 1;
    await turn();
    assert(requests[0].signal.aborted);
    assert.equal(reader.result.value.kind, 'text');
    assert.equal(resolveObjectURL(url), undefined);
  } finally {
    reader.stop();
  }
});
