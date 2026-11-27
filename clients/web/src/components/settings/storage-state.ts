import { signal } from 'kerfjs';

export type Scope = { kind: 'all' } | { kind: 'project'; project: string };
type Group = { project: string | null; bytes: number; bundles: number };
export type Usage = { bytes: number; bundles: number; projects: Group[] };
export type Report = {
  removed_bundles: number;
  reclaimed_bytes: number;
  active_bundles: number;
  problems: { bundle: string; message: string }[];
};

async function request<T>(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as T;
}

function load() {
  return request<Usage>('/api/v1/feedback/storage');
}

function remove(scope: Scope) {
  return request<Report>('/api/v1/feedback/storage/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, confirmed: true }),
  });
}

export function formatBytes(bytes: number) {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  const index = bytes === 0 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1000)), units.length - 1);
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(bytes / 1000 ** index)} ${units[index]}`;
}

export function createStorageState(read = load, cleanup = remove) {
  const usage = signal<Usage | null>(null);
  const scope = signal<Scope | null>(null);
  const loading = signal(false);
  const deleting = signal(false);
  const error = signal('');
  const report = signal<Report | null>(null);
  /** The result of the last Copy Path (GB2-SWK512). */
  const copied = signal('');

  async function refresh() {
    if (loading.value) return;
    loading.value = true;
    error.value = '';
    copied.value = '';
    try {
      usage.value = await read();
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : 'Could not read feedback storage.';
    } finally {
      loading.value = false;
    }
  }

  function confirm(target: Scope | null) {
    if (!deleting.value && (!loading.value || target === null)) scope.value = target;
  }

  async function clear() {
    const target = scope.value;
    if (target === null || deleting.value || loading.value) return;
    deleting.value = true;
    report.value = null;
    error.value = '';
    try {
      report.value = await cleanup(target);
      scope.value = null;
      await refresh();
    } catch (failure) {
      error.value = failure instanceof Error ? failure.message : 'Could not clear saved feedback.';
    } finally {
      deleting.value = false;
    }
  }

  return { usage, scope, loading, deleting, error, report, copied, refresh, confirm, clear };
}

export type StorageState = ReturnType<typeof createStorageState>;
