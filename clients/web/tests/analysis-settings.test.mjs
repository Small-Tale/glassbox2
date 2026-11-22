import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnalysisSettingsState } from '../src/components/settings/analysis-settings-state.ts';

test('a late model list cannot change another provider or an explicit disable', async () => {
  const oldModels = Promise.withResolvers();
  const providers = ['local', 'secondary'].map((id) => ({ id, name: id, executable: `/${id}` }));
  let saved = { provider: 'local', model: null, guidance_topics: [] };
  const state = createAnalysisSettingsState(
    async () => ({ providers, preferences: saved }),
    async (provider) => (provider === 'local' ? oldModels.promise : ['new-model']),
    async (prefs) => {
      saved = prefs;
    },
  );
  await state.refresh();
  const pending = state.loadModels();
  state.chooseProvider('unapproved');
  assert.equal(state.draft.value.provider, 'local');
  state.chooseProvider('secondary');
  await state.loadModels();
  oldModels.resolve(['old-model']);
  await pending;
  assert.deepEqual(state.models.value, ['new-model']);
  state.chooseModel('old-model');
  assert.equal(state.draft.value.model, null);
  state.chooseModel('new-model');
  state.chooseTopic('testing', true);
  state.chooseTopic('testing', true);
  assert(await state.save());
  assert.deepEqual(saved, { provider: 'secondary', model: 'new-model', guidance_topics: ['testing'] });
  state.chooseProvider(null);
  state.chooseTopic('testing', false);
  await state.save();
  await state.refresh();
  assert.deepEqual(state.draft.value, { provider: null, model: null, guidance_topics: [] });
});
