import assert from 'node:assert/strict';
import test from 'node:test';

import { createHandoffState } from '../src/components/handoff/handoff-state.ts';

const source = { kind: 'difftool' };

test('repeated handoffs flush edits and report the result of the underlying clipboard operation', async () => {
  const flush = Promise.withResolvers();
  const writes = [];
  let preparations = 0;
  const state = createHandoffState(
    () => {
      preparations++;
      return Promise.resolve('Read review.md.');
    },
    async (value) => {
      writes.push(await value);
    },
  );
  const first = state.copyInstruction(source, () => flush.promise);
  assert.equal(state.pending.value, true);
  assert.equal(preparations, 0);
  await state.copyInstruction(source, () => Promise.resolve(true));
  flush.resolve(true);
  await first;
  assert.deepEqual(writes, ['Read review.md.']);
  assert.equal(state.status.value, 'AI instruction copied.');
  await state.copyInstruction(source, () => Promise.resolve(false));
  assert.equal(preparations, 1);
  assert.match(state.status.value, /Save your current comment/);
  await state.copyInstruction(source, () => Promise.resolve(true));
  assert.deepEqual(writes, ['Read review.md.', 'Read review.md.']);
  assert.equal(state.status.value, 'AI instruction copied.');
});
