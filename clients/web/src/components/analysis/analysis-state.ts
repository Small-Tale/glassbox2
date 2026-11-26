import { signal } from 'kerfjs';

import type { ReviewSource } from '../review/review-source.js';

export type Mode = 'risk' | 'guidance';
export type JobMode = Mode | 'narrative';

export type Step = { side: 'before' | 'after'; line: number; text: string };
type FileResult = {
  path: string;
  revision: string;
  analysis:
    { kind: 'risk'; rationale: string; aggregate?: number } | { kind: 'guidance'; overview: string; steps: Step[] };
};
type Result = {
  files: FileResult[];
  narrative?: { path: string; revision: string | null; reason: string }[];
  skipped: string[];
  failures?: { path: string; message: string }[];
};
export type Selection = { path: string; revision: string };

type Job = { id: number } & (
  | { status: 'running'; completed: number; total: number }
  | { status: 'complete' | 'partial'; result: Result }
  | { status: 'failed' | 'unavailable'; message: string }
  | { status: 'cancelled' | 'stale' }
);

async function json(url: string, options?: RequestInit): Promise<Job> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as Job;
}

const endpoint = '/api/v1/review/analysis';
const transport = {
  start: (source: ReviewSource, mode: JobMode) =>
    json(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, mode }),
    }),
  status: (id: number, signal: AbortSignal) => json(`${endpoint}/${id}`, { signal }),
  cancel: (id: number) => json(`${endpoint}/${id}`, { method: 'DELETE' }),
  wait: () => new Promise<void>((resolve) => setTimeout(resolve, 250)),
};

function createMode() {
  return {
    enabled: signal(false),
    status: signal<Job | null>(null),
    pending: signal(false),
    error: signal(''),
    request: null as AbortController | null,
  };
}

export function createAnalysisState(onComplete: () => void, api = transport) {
  const modes = { risk: createMode(), guidance: createMode(), narrative: createMode() };
  const stepIndex = signal(0);
  let current: ReviewSource | null = null;
  let selectedIndex: number | undefined;

  function stop(mode: JobMode) {
    const job = modes[mode];
    job.request?.abort();
    job.request = null;
    job.enabled.value = false;
    job.pending.value = false;
  }

  function setSource(source: ReviewSource | null) {
    if (source === current) return;
    current = source;
    for (const mode of ['risk', 'guidance', 'narrative'] as const) {
      stop(mode);
      modes[mode].status.value = null;
      modes[mode].error.value = '';
    }
    stepIndex.value = 0;
  }

  async function toggle(mode: JobMode, selection?: Selection) {
    const job = modes[mode];
    if (job.enabled.value) {
      stop(mode);
      return;
    }
    const source = current;
    if (source === null) return;
    job.enabled.value = true;
    job.error.value = '';
    if (mode === 'guidance') stepIndex.value = 0;
    const cached = job.status.value;
    if (
      cached?.status === 'complete' &&
      selection !== undefined &&
      cached.result.files.some((file) => file.path === selection.path && file.revision === selection.revision)
    )
      return;
    job.status.value = null;
    job.pending.value = true;
    const request = new AbortController();
    job.request = request;
    const cancelled = () => request.signal.aborted;
    let latest: Job | undefined;
    try {
      latest = await api.start(source, mode);
      while (!cancelled() && latest.status === 'running') {
        job.status.value = latest;
        await api.wait();
        if (!cancelled()) latest = await api.status(latest.id, request.signal);
      }
      if (!cancelled()) {
        job.status.value = latest;
        if (latest.status === 'complete' || latest.status === 'partial') onComplete();
      }
    } catch (error) {
      if (!cancelled()) {
        job.error.value = error instanceof Error ? error.message : 'Could not run review analysis.';
      }
    } finally {
      if (cancelled() && latest?.status === 'running') {
        await api.cancel(latest.id).catch(() => undefined);
      }
      if (job.request === request) {
        job.pending.value = false;
        job.request = null;
      }
    }
  }

  function setSelected(index: number | undefined) {
    if (selectedIndex === index) return;
    selectedIndex = index;
    stepIndex.value = 0;
  }

  return { modes, stepIndex, setSource, setSelected, toggle };
}

export type AnalysisState = ReturnType<typeof createAnalysisState>;
