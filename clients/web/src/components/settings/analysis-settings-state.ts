import { signal } from 'kerfjs';

export const guidanceTopics = [
  { value: 'architecture', label: 'Architecture' },
  { value: 'dependencies', label: 'Dependencies' },
  { value: 'error_handling', label: 'Error Handling' },
  { value: 'performance', label: 'Performance' },
  { value: 'testing', label: 'Testing' },
] as const;

type Topic = (typeof guidanceTopics)[number]['value'];
type Provider = { id: string; name: string; executable: string };
export type AnalysisPreferences = { provider: string | null; model: string | null; guidance_topics: Topic[] };
type View = { preferences: AnalysisPreferences; providers: Provider[] };
const route = '/api/v1/settings/analysis';

async function checked(response: Response) {
  if (!response.ok) throw new Error(await response.text());
  return response;
}

async function load(): Promise<View> {
  return (await (await checked(await fetch(route))).json()) as View;
}

async function fetchModels(provider: string): Promise<string[]> {
  const response = await checked(
    await fetch(`${route}/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    }),
  );
  return (await response.json()) as string[];
}

async function persist(prefs: AnalysisPreferences) {
  await checked(
    await fetch(route, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prefs),
    }),
  );
}

export function createAnalysisSettingsState(read = load, list = fetchModels, write = persist) {
  const view = signal<View | null>(null);
  const draft = signal<AnalysisPreferences>({ provider: null, model: null, guidance_topics: [] });
  const models = signal<string[] | null>(null);
  const pending = signal<'settings' | 'models' | 'save' | null>(null);
  const error = signal('');
  let sequence = 0;

  async function refresh() {
    const request = ++sequence;
    view.value = null;
    models.value = null;
    error.value = '';
    pending.value = 'settings';
    try {
      const result = await read();
      if (request !== sequence) return;
      draft.value = result.preferences;
      view.value = result;
    } catch (failure) {
      if (request === sequence) error.value = String(failure);
    } finally {
      if (request === sequence) pending.value = null;
    }
  }

  function chooseProvider(id: string | null) {
    if (id !== null && view.value?.providers.some((provider) => provider.id === id) !== true) return;
    sequence++;
    error.value = '';
    pending.value = null;
    models.value = null;
    draft.value = { ...draft.value, provider: id, model: null };
  }

  async function loadModels() {
    const provider = draft.value.provider;
    if (provider === null || pending.value !== null) return;
    const request = ++sequence;
    pending.value = 'models';
    error.value = '';
    try {
      const result = await list(provider);
      if (request !== sequence) return;
      models.value = result;
    } catch (failure) {
      if (request === sequence) error.value = String(failure);
    } finally {
      if (request === sequence) pending.value = null;
    }
  }

  function chooseModel(model: string | null) {
    if (model === null || models.value?.includes(model) === true) draft.value = { ...draft.value, model };
  }

  function chooseTopic(value: string, enabled: boolean) {
    const topic = guidanceTopics.find((item) => item.value === value);
    if (topic === undefined) return;
    const selected = new Set(draft.value.guidance_topics);
    if (enabled) selected.add(topic.value);
    else selected.delete(topic.value);
    draft.value = {
      ...draft.value,
      guidance_topics: guidanceTopics.map(({ value }) => value).filter((key) => selected.has(key)),
    };
  }

  async function save() {
    if (view.value === null || pending.value !== null) return false;
    pending.value = 'save';
    error.value = '';
    try {
      await write(draft.value);
      return true;
    } catch (failure) {
      error.value = String(failure);
      return false;
    } finally {
      pending.value = null;
    }
  }
  return { view, draft, models, pending, error, refresh, chooseProvider, loadModels, chooseModel, chooseTopic, save };
}

export type AnalysisSettingsState = ReturnType<typeof createAnalysisSettingsState>;
