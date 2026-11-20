import { effect, signal } from 'kerfjs';

import type { ReviewSource, ReviewSourceState } from '../review/review-source.js';

export const categories = [
  { value: 'bug', label: 'Bug' },
  { value: 'fix', label: 'Fix Needed' },
  { value: 'style', label: 'Style' },
  { value: 'pattern-follow', label: 'Pattern Follow' },
  { value: 'pattern-avoid', label: 'Pattern Avoid' },
  { value: 'note', label: 'Note' },
  { value: 'remember', label: 'Remember' },
] as const;

export type Category = (typeof categories)[number]['value'];
export type Side = 'before' | 'after';
export type ImageRegion = { kind: 'image_region'; left: number; top: number; width: number; height: number };
export type Anchor = {
  path: string;
  side: Side;
  revision: string;
  target: { kind: 'line'; start: number; end: number } | ImageRegion;
};
type Message = { author: string; markdown: string; attachments: { id: number; filename: string }[] };
export type Thread = {
  id: number;
  revision: number;
  anchor: Anchor;
  origin:
    { kind: 'reviewer'; category: Category } | { kind: 'ai'; tags: string[]; risk: 'low' | 'medium' | 'high' | null };
  opening: Message;
  replies: { id: number; message: Message }[];
};
type Selection = { source: ReviewSource; index: number; path: string };
type Operation = Record<string, unknown>;
type ArtifactPreview = { source: string; url?: string };

export function isDiagramAttachment(filename: string): boolean {
  return /\.(?:dot|gv|mmd|mermaid|puml|plantuml)$/iu.test(filename);
}

async function request(selection: Selection, operation?: Operation, abort?: AbortSignal) {
  const response = await fetch('/api/v1/review/discussion', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection, operation }),
    signal: abort,
  });
  if (!response.ok) throw new Error(await response.text());
  return ((await response.json()) as { threads: Thread[] }).threads;
}

export function createDiscussionState(source: ReviewSourceState, load = request) {
  const threads = signal<Thread[]>([]);
  const threadId = signal<number | null>(null);
  const adding = signal<Anchor | null>(null);
  const author = signal('You');
  const category = signal<Category>('note');
  const text = signal('');
  const reply = signal('');
  const pending = signal(false);
  const error = signal('');
  const artifact = signal<{ id: number; label: string; preview?: ArtifactPreview; message?: string } | null>(null);
  let artifactRequest: AbortController | undefined;
  let current: Selection | null = null;
  let refreshSequence = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: { selection: Selection; done: Promise<Thread[]> } | undefined;

  function activeThread() {
    return threads.value.find(({ id }) => id === threadId.value);
  }

  function resetEditor() {
    closeArtifact();
    clearTimeout(timer);
    threadId.value = null;
    adding.value = null;
    reply.value = '';
    text.value = '';
    error.value = '';
  }

  const stop = effect(() => {
    const active = source.activeSource.value;
    const index = source.selected.value;
    const file = index === undefined ? undefined : source.review.value?.files[index];
    const selection =
      active === null || index === undefined || file === undefined ? null : { source: active, index, path: file.path };
    current = selection;
    resetEditor();
    threads.value = [];
    pending.value = false;
    if (selection === null) return;
    const controller = new AbortController();
    pending.value = true;
    void load(selection, undefined, controller.signal)
      .then(
        (items) => {
          if (!controller.signal.aborted) threads.value = items;
        },
        (failure: unknown) => {
          if (!controller.signal.aborted) error.value = String(failure);
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) pending.value = false;
      });
    return () => {
      controller.abort();
      closeArtifact();
    };
  });

  function closeArtifact() {
    artifactRequest?.abort();
    artifact.value = null;
  }

  async function previewArtifact(id: number) {
    if (artifact.value?.id === id) {
      closeArtifact();
      return;
    }
    const selection = current;
    const thread = activeThread();
    if (selection === null || thread === undefined) return;
    const attachment = [thread.opening, ...thread.replies.map(({ message }) => message)]
      .flatMap(({ attachments }) => attachments)
      .find((item) => item.id === id);
    if (attachment === undefined) return;
    closeArtifact();
    const controller = new AbortController();
    artifactRequest = controller;
    const label = attachment.filename;
    artifact.value = { id, label };
    try {
      const response = await fetch('/api/v1/review/diagram/attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection, thread: thread.id, attachment: id }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Could not read the attached diagram.');
      const { source, svg } = (await response.json()) as { source: string; svg: string | null };
      if (controller.signal.aborted) return;
      const url = svg === null ? undefined : `data:image/svg+xml,${encodeURIComponent(svg)}`;
      artifact.value = { id, label, preview: { source, url } };
    } catch {
      if (!controller.signal.aborted) artifact.value = { id, label, message: 'Could not read the attached diagram.' };
    }
  }

  async function save(operation: Operation) {
    const selection = current;
    if (selection === null || pending.value) return false;
    refreshSequence++;
    pending.value = true;
    error.value = '';
    try {
      const done = load(selection, operation);
      writing = { selection, done };
      const items = await done;
      if (selection !== current) return false;
      threads.value = items;
      return true;
    } catch (failure) {
      if (selection === current)
        error.value = failure instanceof Error ? failure.message : 'Could not save discussion.';
      return false;
    } finally {
      if (writing?.selection === selection) writing = undefined;
      if (selection === current) pending.value = false;
    }
  }

  async function refreshCurrent() {
    const selection = current;
    const sequence = ++refreshSequence;
    if (selection === null) return;
    try {
      if (writing?.selection === selection) await writing.done;
      const items = await load(selection);
      if (selection === current && sequence === refreshSequence) threads.value = items;
    } catch (failure) {
      if (selection === current && sequence === refreshSequence) error.value = String(failure);
    }
  }

  async function apply(change: Operation) {
    const thread = activeThread();
    if (thread === undefined) return false;
    return await save({ kind: 'apply', id: thread.id, revision: thread.revision, change });
  }

  async function attach(filename: string, content: string) {
    if (!(await saveEdit())) return false;
    const thread = activeThread();
    if (thread === undefined) return false;
    return await save({ kind: 'attach', id: thread.id, revision: thread.revision, filename, content });
  }

  async function saveEdit() {
    clearTimeout(timer);
    const selection = current;
    const id = threadId.value;
    if (writing?.selection === selection) {
      // The writer reports errors itself. Keep the current editor open when saving failed.
      try {
        await writing.done;
      } catch {
        return false;
      }
    }
    if (selection !== current || id !== threadId.value) return false;
    const thread = activeThread();
    const markdown = text.value;
    if (thread?.origin.kind !== 'reviewer' || markdown === thread.opening.markdown) return true;
    if (markdown.trim() === '') {
      error.value = 'A comment needs text.';
      return false;
    }
    return await apply({ kind: 'edit', message: { kind: 'opening' }, markdown });
  }

  async function showThread(id: number) {
    if (!(await saveEdit())) return;
    const thread = threads.value.find((item) => item.id === id);
    if (thread === undefined) return;
    resetEditor();
    threadId.value = id;
    text.value = thread.opening.markdown;
  }

  async function showAdd(anchor: Anchor) {
    if (!(await saveEdit())) return;
    resetEditor();
    adding.value = anchor;
    category.value = 'note';
  }

  async function submitComment() {
    const anchor = adding.value;
    if (anchor === null) return;
    const existing = new Set(threads.value.map(({ id }) => id));
    if (await save({ kind: 'create', anchor, category: category.value, author: author.value, markdown: text.value })) {
      const created = threads.value.find(({ id }) => !existing.has(id));
      if (created !== undefined) await showThread(created.id);
    }
  }

  function edit(value: string) {
    text.value = value;
    clearTimeout(timer);
    if (activeThread() !== undefined) {
      timer = setTimeout(() => void saveEdit(), 350);
    }
  }

  return {
    threads,
    threadId,
    adding,
    author,
    category,
    text,
    reply,
    pending,
    error,
    artifact,
    previewArtifact,
    stop,
    activeThread,
    refreshCurrent,
    apply,
    attach,
    showThread,
    showAdd,
    submitComment,
    saveEdit,
    edit,
    resetEditor,
  };
}

export type DiscussionState = ReturnType<typeof createDiscussionState>;
