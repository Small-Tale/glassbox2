import { effect, signal } from 'kerfjs';

import type { ReviewSource, ReviewSourceState } from '../review/review-source.js';
import type { FileContent, MediaMetadata, MediaSides } from './text-diff-model.js';

export type MediaImage = MediaMetadata & { url: string; source?: string };
type Result =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | Exclude<FileContent, { kind: 'media' }>
  | ({ kind: 'media' } & MediaSides<MediaImage>);
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
    const selection = { source, index, path: file.path };
    const urls: string[] = [];
    async function image(side: 'before' | 'after', metadata: MediaMetadata | null): Promise<MediaImage | null> {
      if (metadata === null) return null;
      const response = await fetch('/api/v1/review/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selection, side, revision: metadata.revision }),
        signal: abort,
      });
      if (!response.ok) throw new Error(await response.text());
      const blob = await response.blob();
      const source = metadata.content_type === 'image/svg+xml' ? await blob.text() : undefined;
      if (abort.aborted) return null;
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return { ...metadata, url, source };
    }
    void load(selection, abort)
      .then(async (content): Promise<Result> => {
        if (content.kind !== 'media') return content;
        const [before, after] = await Promise.all([image('before', content.before), image('after', content.after)]);
        return { kind: 'media', before, after };
      })
      .then(
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
      for (const url of urls) URL.revokeObjectURL(url);
    };
  });
  return { result, stop };
}
