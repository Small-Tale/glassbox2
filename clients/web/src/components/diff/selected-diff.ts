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

function svgDataUrl(bytes: Uint8Array): string {
  const chunkSize = 32_768;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

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
  const diagram = signal<MediaSides<MediaImage> | null>(null);
  const showDiagram = signal(false);
  const diagramPending = signal(false);
  const diagramError = signal('');
  let renderCurrent: (() => Promise<void>) | undefined;
  const stop = effect(() => {
    const source = state.activeSource.value;
    const index = state.selected.value;
    const file = index === undefined ? undefined : state.review.value?.files[index];
    diagram.value = null;
    showDiagram.value = false;
    diagramPending.value = false;
    diagramError.value = '';
    renderCurrent = undefined;
    if (source === null || index === undefined || file === undefined) {
      result.value = null;
      return;
    }
    const controller = new AbortController();
    const abort = controller.signal;
    result.value = { kind: 'loading' };
    const selection = { source, index, path: file.path };
    const urls: string[] = [];
    renderCurrent = async () => {
      const file = result.value;
      if (file?.kind !== 'text' || file.diagram !== true) return;
      diagramPending.value = true;
      diagramError.value = '';
      try {
        const response = await fetch('/api/v1/review/diagram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...selection, revision: file.revision }),
          signal: abort,
        });
        if (!response.ok) throw new Error(await response.text());
        const rendered = (await response.json()) as MediaSides<string>;
        if (abort.aborted) return;
        function image(svg: string | null): MediaImage | null {
          if (svg === null) return null;
          const size = new TextEncoder().encode(svg).length;
          return {
            url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
            size,
            content_type: 'image/svg+xml',
            revision: '',
          };
        }
        diagram.value = { before: image(rendered.before), after: image(rendered.after) };
        showDiagram.value = true;
      } catch {
        if (!abort.aborted) diagramError.value = 'Diagram preview unavailable. The source comparison is still open.';
      } finally {
        if (!abort.aborted) diagramPending.value = false;
      }
    };
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
      abort.throwIfAborted();
      if (metadata.content_type === 'image/svg+xml') {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        abort.throwIfAborted();
        return { ...metadata, url: svgDataUrl(bytes), source: new TextDecoder().decode(bytes) };
      }
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return { ...metadata, url };
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
  async function toggleDiagram() {
    if (diagram.value !== null) showDiagram.value = !showDiagram.value;
    else if (!diagramPending.value) await renderCurrent?.();
  }
  return { result, stop, diagram, showDiagram, diagramPending, diagramError, toggleDiagram };
}
