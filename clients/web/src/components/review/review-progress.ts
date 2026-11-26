import { effect, signal } from 'kerfjs';

import type { ReviewSource, ReviewSourceState } from './review-source.js';

/** HS2-FTEQVQ: `reviewed` while the marked content is current, `changed` once the file moved on after the mark. */
export type FileProgress = 'reviewed' | 'changed';

type Selection = { source: ReviewSource; index: number; path: string };
type Content = {
  kind: string;
  revision?: string;
  before?: { revision?: string } | null;
  after?: { revision?: string } | null;
};
type Fetchers = {
  list: (source: ReviewSource, abort: AbortSignal) => Promise<{ path: string; state: FileProgress }[]>;
  mark: (selection: Selection, revision: string, reviewed: boolean) => Promise<void>;
};

/**
 * The revision of the content a person is looking at, in the form the host derives: the text revision, both media
 * revisions, or a fixed marker for content with no revision of its own. Null while nothing is loaded.
 */
export function fileRevision(content: Content | null): string | null {
  if (content === null) return null;
  switch (content.kind) {
    case 'text':
      return content.revision ?? null;
    case 'media':
      return `media:${content.before?.revision ?? ''}:${content.after?.revision ?? ''}`;
    case 'unavailable_lfs':
      return 'lfs-unavailable';
    case 'binary':
      return 'binary';
    default:
      return null;
  }
}

async function post(endpoint: string, body: unknown, abort?: AbortSignal) {
  const response = await fetch(`/api/v1/review/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: abort,
  });
  if (!response.ok) throw new Error(await response.text());
  return response;
}

const host: Fetchers = {
  async list(source, abort) {
    const response = await post('progress', { source }, abort);
    return ((await response.json()) as { files: { path: string; state: FileProgress }[] }).files;
  },
  async mark(selection, revision, reviewed) {
    await post('progress/mark', { ...selection, revision, reviewed });
  },
};

/** Which files of the open comparison are reviewed; the marks live on the host with the comparison's identity. */
export function createReviewProgress(
  source: ReviewSourceState,
  content: { readonly value: Content | null },
  fetchers: Fetchers = host,
) {
  const files = signal<ReadonlyMap<string, FileProgress>>(new Map());
  const pending = signal(false);
  const error = signal('');
  let controller = new AbortController();

  /** Load the marks of the comparison now open, replacing those of the one before. */
  function reload() {
    const review = source.review.value;
    const active = source.activeSource.value;
    controller.abort();
    controller = new AbortController();
    const { signal: abort } = controller;
    files.value = new Map();
    error.value = '';
    pending.value = false;
    if (review === null || active === null || review.files.length === 0) return;
    void fetchers.list(active, abort).then(
      (marks) => {
        if (!abort.aborted) files.value = new Map(marks.map(({ path, state }) => [path, state]));
      },
      (failure: unknown) => {
        if (!abort.aborted)
          error.value = failure instanceof Error ? failure.message : 'Could not load review progress.';
      },
    );
  }

  function selection(): Selection | null {
    const active = source.activeSource.value;
    const index = source.selected.value;
    const file = index === undefined ? undefined : source.review.value?.files[index];
    return active === null || index === undefined || file === undefined
      ? null
      : { source: active, index, path: file.path };
  }

  /** Mark the selected file reviewed, or clear its mark when it is reviewed now. */
  async function toggleSelected() {
    const target = selection();
    const revision = fileRevision(content.value);
    if (target === null || revision === null || pending.peek()) return;
    const reviewed = files.peek().get(target.path) !== 'reviewed';
    const { signal: abort } = controller;
    pending.value = true;
    error.value = '';
    try {
      await fetchers.mark(target, revision, reviewed);
      if (abort.aborted) return;
      const next = new Map(files.peek());
      if (reviewed) next.set(target.path, 'reviewed');
      else next.delete(target.path);
      files.value = next;
    } catch (failure) {
      if (abort.aborted) return;
      error.value = failure instanceof Error ? failure.message : 'Could not save review progress.';
    } finally {
      if (!abort.aborted) pending.value = false;
    }
  }

  /** Whether a file is loaded to mark and no mark is being saved. */
  function ready() {
    return fileRevision(content.value) !== null && !pending.value;
  }

  function reviewedCount() {
    let count = 0;
    for (const state of files.value.values()) if (state === 'reviewed') count += 1;
    return count;
  }

  return { files, pending, error, reload, toggleSelected, ready, reviewedCount };
}

export type ReviewProgress = ReturnType<typeof createReviewProgress>;

/** Reload the marks whenever the open comparison changes; returns the disposer. */
export function watchReviewProgress(progress: Pick<ReviewProgress, 'reload'>) {
  return effect(() => {
    progress.reload();
  });
}
