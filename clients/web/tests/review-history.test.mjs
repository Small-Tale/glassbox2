import assert from 'node:assert/strict';
import test from 'node:test';

import { createReviewHistory } from '../src/components/review/review-history.ts';

test('file history restores each visit and discards the forward branch only on a new visit', () => {
  const history = createReviewHistory();
  history.visit(0);
  history.save({ top: 140, left: 35 });
  history.visit(0);
  assert.equal(history.canMove(-1), false);
  history.visit(1);
  history.save({ top: 270, left: 0 });
  assert.deepEqual(history.move(-1), { index: 0, position: { top: 140, left: 35 } });
  history.save({ top: 150, left: 35 });
  assert.deepEqual(history.move(1), { index: 1, position: { top: 270, left: 0 } });
  assert.deepEqual(history.move(-1).position, { top: 150, left: 35 });
  history.visit(2);
  assert.equal(history.canMove(1), false);
  assert.equal(history.move(-1).index, 0);
  history.clear();
  assert.equal(history.current(), undefined);
  assert.equal(history.canMove(-1), false);
  assert.equal(history.canMove(1), false);
  history.visit(2);
  assert.deepEqual(history.current(), { index: 2, position: { top: 0, left: 0 } });
});
