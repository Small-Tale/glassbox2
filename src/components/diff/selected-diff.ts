import { effect, signal } from 'kerfjs';

import type { ReviewSource, ReviewSourceState } from '../review/review-source.js';
import type { FileContent } from './text-diff-model.js';

type Result = { kind: 'loading' } | { kind: 'error'; message: string } | FileContent;
type Selection = { source: ReviewSource; index: number; path: string };

async function fetchContent(selection: Selection, abort: AbortSignal): Promise<FileContent> {
  const response = await fetch('/api/v1/review/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(selection),
    signal: abort,
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as FileContent;
}

export function selectedDiff(state: ReviewSourceState, load = fetchContent) {
  const result = signal<Result | null>(null);
  const stop = effect(() => {
    const source = state.activeSource.value;
    const index = state.selected.value;
    const file = index === undefined ? undefined : state.review.value?.files[index];
    if (source === null || index === undefined || file === undefined) {
      result.value = null;
      return;
    }
    const controller = new AbortController();
    const abort = controller.signal;
    result.value = { kind: 'loading' };
    void load({ source, index, path: file.path }, abort).then(
      (content) => {
        if (!abort.aborted) result.value = content;
      },
      (failure: unknown) => {
        if (!abort.aborted) {
          result.value = {
            kind: 'error',
            message: failure instanceof Error ? failure.message : 'Could not load the selected file.',
          };
        }
      },
    );
    return () => {
      controller.abort();
    };
  });
  return { result, stop };
}
