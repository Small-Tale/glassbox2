import assert from 'node:assert/strict';
import test from 'node:test';

import { createRendererState } from '../src/components/settings/renderer-state.ts';

// HS2-Q9TXER: renderer readiness is read on demand and its failures are reported.
const readiness = (state) => ({
  renderer: { state: 'local', variable: 'GLASSBOX_CONTENT_RENDERER', path: '/opt/glassbox-render-local' },
  formats: [{ id: 'plantuml', name: 'PlantUML', extensions: ['.puml'], state, requirements: [], install: '' }],
});

test('refresh reads readiness, and a second read replaces it', async () => {
  const answers = [readiness('needs_setup'), readiness('ready')];
  const state = createRendererState(() => Promise.resolve(answers.shift()));
  assert.equal(state.readiness.value, null);
  await state.refresh();
  assert.equal(state.readiness.value.formats[0].state, 'needs_setup');
  await state.refresh();
  assert.equal(state.readiness.value.formats[0].state, 'ready');
  assert.equal(state.loading.value, false);
  assert.equal(state.error.value, '');
});

test('a failed read reports the error, keeps what was shown and recovers on the next read', async () => {
  const outcomes = [
    () => Promise.resolve(readiness('ready')),
    () => Promise.reject(new Error('The host is unavailable.')),
    () => Promise.resolve(readiness('needs_setup')),
  ];
  const state = createRendererState(() => outcomes.shift()());
  await state.refresh();
  await state.refresh();
  assert.match(state.error.value, /unavailable/u);
  assert.equal(state.readiness.value.formats[0].state, 'ready', 'the last good report stays');
  assert.equal(state.loading.value, false);
  await state.refresh();
  assert.equal(state.error.value, '');
  assert.equal(state.readiness.value.formats[0].state, 'needs_setup');
});

test('a read already in flight is not started twice', async () => {
  const gate = Promise.withResolvers();
  let reads = 0;
  const state = createRendererState(() => {
    reads += 1;
    return gate.promise;
  });
  const first = state.refresh();
  assert.equal(state.loading.value, true);
  await state.refresh();
  assert.equal(reads, 1);
  gate.resolve(readiness('ready'));
  await first;
  assert.equal(state.loading.value, false);
  assert.equal(state.readiness.value.formats[0].state, 'ready');
});
