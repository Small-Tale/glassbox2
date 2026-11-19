import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

test('the application ownership directories exist', async () => {
  for (const name of ['app', 'components', 'features', 'platform', 'shared', 'ux-demo/demos']) {
    assert.equal((await stat(resolve('src', name))).isDirectory(), true, name);
  }
});
