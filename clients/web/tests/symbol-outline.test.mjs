import assert from 'node:assert/strict';
import test from 'node:test';

import { createSymbolOutline, outlineSides, outlineTree } from '../src/components/review/symbol-outline.ts';

// HS2-E3YMJ5: the outline tree, the sides a file has, and the loading sequence.
const symbols = [
  { name: 'View', kind: 'class', line: 1, depth: 0 },
  { name: 'render', kind: 'method', line: 2, depth: 1 },
  { name: 'make', kind: 'method', line: 3, depth: 1 },
  { name: 'build', kind: 'function', line: 5, depth: 0 },
];
const names = (nodes) => nodes.map((node) => [node.symbol.name, names(node.children)]);

test('the tree nests declarations by depth and ignores deeper orphans', () => {
  assert.deepEqual(names(outlineTree(symbols, '')), [
    [
      'View',
      [
        ['render', []],
        ['make', []],
      ],
    ],
    ['build', []],
  ]);
  assert.deepEqual(
    outlineTree(symbols, '').map((node) => node.id),
    ['symbol:0', 'symbol:3'],
  );
  assert.deepEqual(names(outlineTree([{ name: 'deep', kind: 'method', line: 1, depth: 2 }], '')), [['deep', []]]);
  assert.deepEqual(outlineTree([], ''), []);
});

test('filtering keeps matching declarations with their ancestors, and a matching container keeps its members', () => {
  assert.deepEqual(names(outlineTree(symbols, 'REN')), [['View', [['render', []]]]]);
  assert.deepEqual(names(outlineTree(symbols, 'view')), [
    [
      'View',
      [
        ['render', []],
        ['make', []],
      ],
    ],
  ]);
  assert.deepEqual(outlineTree(symbols, 'zzz'), []);
  assert.equal(outlineTree(symbols, '  ').length, 2);
});

test('added and deleted files have one side', () => {
  assert.deepEqual(outlineSides('added'), ['after']);
  assert.deepEqual(outlineSides('deleted'), ['before']);
  assert.deepEqual(outlineSides('modified'), ['before', 'after']);
  assert.deepEqual(outlineSides('renamed'), ['before', 'after']);
});

const selection = (revision = 'r1', index = 0) => ({
  source: { kind: 'git', directory: '/repo', mode: { kind: 'working_tree' } },
  index,
  path: 'a.ts',
  revision,
});
const found = (line = 2) => ({
  status: 'found',
  file: { path: 'a.ts', side: 'after', revision: 'sha', diff_revision: 'r1', index: 0, text: 'x\nfn a() {}\n' },
  symbols: [{ name: 'a', kind: 'function', line, depth: 0 }],
  truncated: false,
});

test('loading serves repeats from memory, reloads on a new revision or side, and drops stale answers', async () => {
  const calls = [];
  const pending = [];
  const outline = createSymbolOutline((chosen, side) => {
    calls.push([chosen.revision, side]);
    return new Promise((resolve) => pending.push(resolve));
  });
  const first = outline.load(selection(), 'after');
  assert.equal(outline.loading.value, true);
  pending[0](found());
  await first;
  assert.equal(outline.loading.value, false);
  assert.equal(outline.result.value.status, 'found');
  await outline.load(selection(), 'after');
  assert.equal(calls.length, 1, 'the same selection is not requested again');

  const stale = outline.load(selection('r1'), 'before');
  const fresh = outline.load(selection('r2'), 'before');
  pending[2](found(9));
  await fresh;
  pending[1](found(1));
  await stale;
  assert.equal(outline.result.value.symbols[0].line, 9, 'the older answer does not replace the newer one');
  assert.equal(outline.loading.value, false);
  assert.deepEqual(
    calls.map(([revision]) => revision),
    ['r1', 'r1', 'r2'],
  );
});

test('a failed request reports the error and a later load recovers', async () => {
  let fail = true;
  const outline = createSymbolOutline(() =>
    fail ? Promise.reject(new Error('The selected diff has changed.')) : Promise.resolve(found()),
  );
  await outline.load(selection(), 'after');
  assert.equal(outline.error.value, 'The selected diff has changed.');
  assert.equal(outline.result.value, null);
  assert.equal(outline.loading.value, false);
  fail = false;
  await outline.load(selection(), 'after');
  assert.equal(outline.error.value, '');
  assert.equal(outline.result.value.status, 'found');
});

test('the destination is the displayed file at the declaration line, and reset clears everything', async () => {
  const outline = createSymbolOutline(() => Promise.resolve(found(2)));
  assert.equal(outline.destination({ name: 'a', kind: 'function', line: 2, depth: 0 }), undefined);
  await outline.load(selection(), 'after');
  assert.deepEqual(outline.destination({ name: 'a', kind: 'function', line: 2, depth: 0 }), {
    path: 'a.ts',
    side: 'after',
    revision: 'sha',
    diff_revision: 'r1',
    index: 0,
    text: 'x\nfn a() {}\n',
    line: 2,
  });
  outline.side.value = 'before';
  outline.filter.value = 'x';
  outline.collapsed.value = new Set(['symbol:0']);
  outline.reset();
  assert.equal(outline.result.value, null);
  assert.equal(outline.side.value, 'after');
  assert.equal(outline.filter.value, '');
  assert.equal(outline.collapsed.value.size, 0);
  await outline.load(selection(), 'after');
  assert.equal(outline.result.value.status, 'found', 'reset forgets what was loaded');
});
