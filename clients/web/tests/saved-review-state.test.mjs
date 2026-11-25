import assert from 'node:assert/strict';
import test from 'node:test';

import { createSavedReviewState } from '../src/components/discussion/saved-review-state.ts';

const source = { kind: 'paths', before: '/before', after: '/after' };
const first = { id: 'review-one', updated_at: 20 };
const second = { id: 'review-two', updated_at: 10 };

test('HS2-42A696 deleting needs a chosen review, can be cancelled, and refreshes the list', async () => {
  const removed = [];
  const state = createSavedReviewState(
    () => Promise.resolve({ reviews: [first, second], active: false, paths: [] }),
    (_source, id) => {
      removed.push(id);
      return Promise.resolve({ reviews: [second], active: false, paths: [] });
    },
  );
  await state.update(source);
  assert.equal(await state.deleteConfirmed(source), false, 'nothing is chosen yet');
  assert.deepEqual(removed, []);

  state.confirmDelete(first);
  state.confirmDelete(null);
  assert.equal(await state.deleteConfirmed(source), false, 'cancel clears the choice');
  assert.deepEqual(removed, []);

  state.confirmDelete(first);
  assert.equal(await state.deleteConfirmed(source), true);
  assert.deepEqual(removed, ['review-one']);
  assert.deepEqual(state.view.value.reviews, [second]);
  assert.equal(state.confirming.value, null);
  assert.equal(state.deleting.value, false);
});

test('HS2-42A696 a refused delete keeps the confirmation open with the host message and can be retried', async () => {
  let attempts = 0;
  const state = createSavedReviewState(
    () => Promise.resolve({ reviews: [first], active: false, paths: [] }),
    () => {
      attempts++;
      if (attempts === 1)
        return Promise.reject(new Error('This review is open in Glassbox. Close it before deleting.'));
      return Promise.resolve({ reviews: [], active: false, paths: [] });
    },
  );
  await state.update(source);
  state.confirmDelete(first);
  assert.equal(await state.deleteConfirmed(source), false);
  assert.equal(state.error.value, 'This review is open in Glassbox. Close it before deleting.');
  assert.equal(state.confirming.value, first);
  assert.equal(state.deleting.value, false);
  assert.equal(await state.deleteConfirmed(source), true);
  assert.equal(state.error.value, '');
  assert.deepEqual(state.view.value.reviews, []);
});

test('HS2-42A696 no delete runs while another delete or a load is in flight', async () => {
  const gate = Promise.withResolvers();
  let calls = 0;
  const state = createSavedReviewState(
    () => Promise.resolve({ reviews: [first], active: false, paths: [] }),
    () => {
      calls++;
      return gate.promise;
    },
  );
  await state.update(source);
  state.confirmDelete(first);
  const running = state.deleteConfirmed(source);
  assert.equal(await state.deleteConfirmed(source), false, 'a second click is ignored');
  state.confirmDelete(null);
  assert.equal(state.confirming.value, first, 'the choice cannot change mid-delete');
  gate.resolve({ reviews: [], active: false, paths: [] });
  assert.equal(await running, true);
  assert.equal(calls, 1);
});
