import { signal } from 'kerfjs';

export const gitModes = [
  { value: 'working_tree', label: 'Working Tree' },
  { value: 'staged', label: 'Staged Changes' },
  { value: 'unstaged', label: 'Unstaged Changes' },
  { value: 'commit', label: 'Commit' },
  { value: 'range', label: 'Commit Range' },
  { value: 'branch', label: 'Branch Comparison' },
] as const;

export type GitMode = (typeof gitModes)[number]['value'];
export type SourceKind = 'git' | 'paths';

export type ReviewSource =
  | { kind: 'git'; directory: string; mode: { kind: GitMode; revision?: string; before?: string; after?: string } }
  | { kind: 'paths'; before: string; after: string }
  | { kind: 'difftool' };

export type ReviewFile = {
  path: string;
  previous_path: string | null;
  status: 'added' | 'copied' | 'deleted' | 'modified' | 'renamed' | 'type_changed' | 'unmerged';
};

export type ReviewFiles = {
  identity: string;
  comparison: string;
  branch: string | null;
  files: ReviewFile[];
};

async function loadFiles(source: ReviewSource): Promise<ReviewFiles> {
  const response = await fetch('/api/v1/review/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as ReviewFiles;
}

export function createReviewSourceState(initial?: ReviewFiles, load = loadFiles) {
  const review = signal<ReviewFiles | null>(initial ?? null);
  const sourceKind = signal<SourceKind>('git');
  const gitMode = signal<GitMode>('working_tree');
  const formOpen = signal(initial === undefined);
  const pending = signal(false);
  const error = signal('');
  const filter = signal('');
  const selected = signal<number | undefined>(undefined);
  const collapsed = signal<ReadonlySet<string>>(new Set());
  const fields = signal<Record<string, string>>({});
  let requestNumber = 0;

  async function open(source: ReviewSource) {
    const request = ++requestNumber;
    pending.value = true;
    error.value = '';
    try {
      const result = await load(source);
      if (request !== requestNumber) return;
      review.value = result;
      selected.value = undefined;
      collapsed.value = new Set();
      filter.value = '';
      formOpen.value = false;
    } catch (failure) {
      if (request !== requestNumber) return;
      error.value = failure instanceof Error ? failure.message : 'Could not open the comparison.';
      formOpen.value = true;
    } finally {
      if (request === requestNumber) pending.value = false;
    }
  }

  async function openDifftool() {
    try {
      const response = await fetch('/api/v1/difftool');
      if (
        response.ok &&
        response.headers.get('Content-Type')?.startsWith('application/json') === true &&
        requestNumber === 0
      ) {
        await open({ kind: 'difftool' });
      }
    } catch {
      // Source entry stays available if the host cannot report an initial launch.
    }
  }

  return {
    review,
    sourceKind,
    gitMode,
    formOpen,
    pending,
    error,
    filter,
    selected,
    collapsed,
    fields,
    open,
    openDifftool,
  };
}

export type ReviewSourceState = ReturnType<typeof createReviewSourceState>;
