import { signal } from 'kerfjs';

export type Appearance = 'system' | 'light' | 'dark';

export function isAppearance(value: unknown): value is Appearance {
  return value === 'system' || value === 'light' || value === 'dark';
}

async function readAppearance(): Promise<Appearance> {
  const response = await fetch('/api/v1/settings');
  if (!response.ok) throw new Error('Could not read Glassbox settings.');
  const settings: unknown = await response.json();
  if (
    typeof settings !== 'object' ||
    settings === null ||
    !('appearance' in settings) ||
    !isAppearance(settings.appearance)
  ) {
    throw new Error('Glassbox returned an invalid appearance setting.');
  }
  return settings.appearance;
}

async function saveAppearance(appearance: Appearance) {
  const response = await fetch('/api/v1/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appearance }),
  });
  if (!response.ok) throw new Error('Could not save Glassbox appearance.');
}

export function createAppearanceState(read = readAppearance, save = saveAppearance) {
  const appearance = signal<Appearance>('system');
  const status = signal('');
  let persisted: Appearance = 'system';
  let lastChoice = 0;
  let writes = Promise.resolve();

  async function load() {
    try {
      const saved = await read();
      if (lastChoice === 0) {
        persisted = saved;
        appearance.value = saved;
      }
    } catch {
      if (lastChoice === 0) status.value = 'Appearance could not be loaded.';
    }
  }

  function choose(value: Appearance) {
    const choice = ++lastChoice;
    appearance.value = value;
    status.value = '';
    writes = writes.then(async () => {
      try {
        await save(value);
        persisted = value;
      } catch {
        if (choice === lastChoice) {
          appearance.value = persisted;
          status.value = 'Appearance could not be saved.';
        }
      }
    });
    return writes;
  }

  return { appearance, status, load, choose };
}

export type AppearanceState = ReturnType<typeof createAppearanceState>;
