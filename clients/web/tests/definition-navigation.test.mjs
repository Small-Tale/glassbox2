import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefinitionLookup, includesDefinition } from '../src/components/review/definition-navigation.ts';
import { createReviewHistory } from '../src/components/review/review-history.ts';

const source = { kind: 'git', directory: 'example', mode: { kind: 'working_tree' } };
const selection = { source, index: 0, path: 'current.ts', revision: 'diff' };
const definition = {
  index: null,
  path: 'old.ts',
  side: 'before',
  line: 2,
  revision: 'before-source',
  diff_revision: null,
  text: '// old\nconst name = true;\n',
};

test('late lookups leave the current view unchanged and unsupported results are reported', async () => {
  const pending = Promise.withResolvers();
  const lookup = createDefinitionLookup((_selection, _side, name) =>
    name === 'old' ? pending.promise : Promise.resolve({ status: 'ambiguous' }),
  );
  const old = lookup.find(selection, 'before', 'old', () => true);
  await lookup.find(selection, 'after', 'two', () => true);
  pending.resolve({ status: 'found', destination: definition });
  assert.equal(await old, undefined);
  assert.equal(lookup.status.value, 'More than one definition matches two.');
  lookup.clear();
  assert.equal(lookup.status.value, '');
});

test('a definition visit retains its side and snapshot through back and forward', () => {
  const history = createReviewHistory();
  history.visit(0);
  history.save({ top: 180, left: 0 });
  history.visitDefinition(0, definition);
  assert.equal(history.current().definition, definition);
  assert.equal(history.current().position, null);
  history.save({ top: 60, left: 4 });
  assert.deepEqual(history.move(-1).position, { top: 180, left: 0 });
  const moved = history.move(1);
  assert.equal(moved.definition.revision, 'before-source');
  assert.deepEqual(moved.position, { top: 60, left: 4 });
  history.move(-1);
  history.visit(1);
  assert.equal(history.canMove(1), false);
});

test('a diff location must match the destination side, line, and text', () => {
  const lines = [{ before_line: 2, after_line: 5, text: 'const name = true;' }];
  assert(includesDefinition([{ lines }], definition));
  assert.equal(includesDefinition([{ lines }], { ...definition, side: 'after' }), false);
  assert.equal(includesDefinition([{ lines }], { ...definition, text: '// old\nconst changed = true;\n' }), false);
});
