import { signal } from 'kerfjs';

export type RequirementState = 'ok' | 'unset' | 'relative' | 'missing';
export type Requirement = { label: string; variable: string; state: RequirementState; path?: string };
export type Format = {
  id: string;
  name: string;
  extensions: string[];
  state: 'ready' | 'needs_setup' | 'unavailable' | 'unchecked';
  requirements: Requirement[];
  install: string;
};
export type Readiness = {
  renderer: { state: 'not_configured' | 'missing' | 'local' | 'custom'; variable: string; path?: string };
  formats: Format[];
};

async function load() {
  const response = await fetch('/api/v1/settings/renderers');
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as Readiness;
}

/** HS2-Q9TXER: what the host knows about its diagram renderer, re-read on demand. */
export function createRendererState(read = load) {
  const readiness = signal<Readiness | null>(null);
  const loading = signal(false);
  const error = signal('');
  /** The result of the last Copy Path (GB2-SWK512). */
  const copied = signal('');

  async function refresh() {
    if (loading.value) return;
    loading.value = true;
    error.value = '';
    copied.value = '';
    try {
      readiness.value = await read();
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : 'Could not read renderer readiness.';
    } finally {
      loading.value = false;
    }
  }

  return { readiness, loading, error, copied, refresh };
}

export type RendererState = ReturnType<typeof createRendererState>;
