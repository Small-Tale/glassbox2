import assert from 'node:assert/strict';
import test from 'node:test';

import { copyText } from '../src/components/settings/copy-text.ts';

// GB2-SWK512: a copy reports success or failure in plain words and never throws.
test('copying answers a status line for success and for a refused clipboard', async () => {
  const written = [];
  assert.equal(await copyText('/a/b', 'Path', (text) => (written.push(text), Promise.resolve())), 'Path copied.');
  assert.deepEqual(written, ['/a/b']);
  assert.equal(await copyText('/a/b', 'Path', () => Promise.reject(new Error('denied'))), 'Could not copy the path.');
  assert.equal(await copyText('x', 'Location', () => Promise.resolve()), 'Location copied.');
  assert.equal(await copyText('x', undefined, () => Promise.reject(new Error('denied'))), 'Could not copy the path.');
});

test('each dialog clears its copy status when it refreshes', async () => {
  const { createRendererState } = await import('../src/components/settings/renderer-state.ts');
  const { createStorageState } = await import('../src/components/settings/storage-state.ts');
  const { createAnalysisSettingsState } = await import('../src/components/settings/analysis-settings-state.ts');
  const renderer = createRendererState(() =>
    Promise.resolve({ renderer: { state: 'not_configured', variable: 'V' }, formats: [] }),
  );
  const storage = createStorageState(() => Promise.resolve({ bytes: 0, bundles: 0, projects: [] }));
  const analysis = createAnalysisSettingsState(() =>
    Promise.resolve({ providers: [], preferences: { provider: null, model: null, guidance_topics: [] } }),
  );
  for (const state of [renderer, storage, analysis]) {
    state.copied.value = 'Path copied.';
    await state.refresh();
    assert.equal(state.copied.value, '');
  }
});
