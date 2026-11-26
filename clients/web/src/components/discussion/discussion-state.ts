import { effect, signal } from 'kerfjs';
import { debounce } from 'kerfjs/timing';

import type { Definition } from '../review/definition-navigation.js';
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
type SourceLocation = { path: string; line: number; revision?: string };
export type Thread = {
  id: number;
  revision: number;
  anchor: Anchor;
  origin:
    | { kind: 'reviewer'; category: Category }
    | {
        kind: 'ai';
        tags: string[];
        risk: 'low' | 'medium' | 'high' | null;
        related_locations?: (SourceLocation | null)[];
      };
  opening: Message;
  replies: { id: number; message: Message }[];
};
type Selection = { source: ReviewSource; index?: number; path: string };
type Operation = Record<string, unknown>;
type ArtifactPreview = { source: string; url?: string };

export function sourceLinkParts(markdown: string, locations: readonly (SourceLocation | null)[]) {
  const parts: (string | { label: string; index: number })[] = [];
  let offset = 0;
  for (const match of markdown.matchAll(/(?<![!\\])\[([^\][\n]+)\]\((\d+)\)/gu)) {
    const [reference, label, target] = match;
    const index = Number(target);
    if (label === undefined || locations[index]?.revision === undefined) continue;
    parts.push(markdown.slice(offset, match.index), { label, index });
    offset = match.index + reference.length;
  }
  parts.push(markdown.slice(offset));
  return parts;
}

export type Relocation =
  | { outcome: 'suggestion'; side: Side; line: number; text: string }
  | { outcome: 'ambiguous' | 'missing' | 'hidden' | 'unavailable' | 'current' };

/** Ask the host where a stale comment's text now is; it stores nothing (HS2-RV5BD8). */
async function relocateThread(selection: Selection & { index: number }, thread: number): Promise<Relocation> {
  const response = await fetch('/api/v1/review/discussion/relocate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection, thread }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as Relocation;
}

async function followSourceLink(selection: Selection, thread: number, index: number): Promise<Definition> {
  const response = await fetch('/api/v1/review/discussion/source-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection, thread, index }),
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()) as Definition;
}

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

export function createDiscussionState(source: ReviewSourceState, load = request, locate = relocateThread) {
  const threads = signal<Thread[]>([]);
  const threadId = signal<number | null>(null);
  const adding = signal<Anchor | null>(null);
  const author = signal('You');
  const category = signal<Category>('note');
  const text = signal('');
  const reply = signal('');
  const pending = signal(false);
  const error = signal('');
  const staleFile = signal<{ source: ReviewSource; path: string } | null>(null);
  /** The open Move Comment form: where the active thread would go (HS2-TGAGQ4). */
  const moving = signal<{ side: Side; line: string } | null>(null);
  /** A suggested new line for the active stale thread: asking, the host's answer, or nothing (HS2-RV5BD8). */
  const relocation = signal<'asking' | Relocation | null>(null);
  let relocateSequence = 0;
  const artifact = signal<{ id: number; label: string; preview?: ArtifactPreview; message?: string } | null>(null);
  let artifactRequest: AbortController | undefined;
  let current: Selection | null = null;
  let refreshSequence = 0;
  let sourceLinkSequence = 0;
  // Autosave trails the last edit by 350 ms (HS2-9RWAAQ); resets and explicit saves cancel it.
  const autosave = debounce(() => void saveEdit(), 350);
  let writing: { selection: Selection; done: Promise<Thread[]> } | undefined;

  function activeThread() {
    return threads.value.find(({ id }) => id === threadId.value);
  }

  async function openSourceLink(index: number, reveal: (destination: Definition) => Promise<void>) {
    const selection = current;
    const thread = activeThread();
    if (selection?.index === undefined || thread?.origin.kind !== 'ai') return;
    const sequence = ++sourceLinkSequence;
    const active = () => sequence === sourceLinkSequence && selection === current && thread === activeThread();
    error.value = '';
    try {
      const destination = await followSourceLink(selection, thread.id, index);
      if (active()) await reveal(destination);
    } catch (failure) {
      if (active()) error.value = failure instanceof Error ? failure.message : 'Could not open the source link.';
    }
  }

  function resetEditor() {
    closeArtifact();
    autosave.cancel();
    threadId.value = null;
    adding.value = null;
    moving.value = null;
    relocation.value = null;
    relocateSequence++;
    reply.value = '';
    text.value = '';
    error.value = '';
  }

  const stop = effect(() => {
    const active = source.activeSource.value;
    const index = source.selected.value;
    const file = index === undefined ? undefined : source.review.value?.files[index];
    const stale = staleFile.value;
    const selection =
      active === null
        ? null
        : file !== undefined
          ? { source: active, index, path: file.path }
          : stale?.source === active
            ? { source: active, path: stale.path }
            : null;
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
    autosave.cancel();
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

  function startMove() {
    const { anchor } = activeThread() ?? {};
    if (anchor?.target.kind !== 'line') return;
    moving.value = { side: anchor.side, line: String(anchor.target.start) };
    error.value = '';
  }

  function cancelMove() {
    moving.value = null;
    error.value = '';
  }

  function editMove(change: Partial<{ side: Side; line: string }>) {
    const form = moving.value;
    if (form !== null) moving.value = { ...form, ...change };
  }

  /** Move the active thread to the chosen side and line of the file on screen; the host validates the destination. */
  async function submitMove(anchorFor: (side: Side, line: number) => Anchor | undefined) {
    const form = moving.value;
    if (form === null || activeThread() === undefined) return false;
    const line = Number(form.line);
    if (!Number.isInteger(line) || line < 1) {
      error.value = 'Enter the number of a line in the file.';
      return false;
    }
    const anchor = anchorFor(form.side, line);
    if (anchor === undefined) {
      error.value = 'Open the comment’s file to move it within that file.';
      return false;
    }
    if (!(await saveEdit())) return false;
    const thread = activeThread();
    if (thread === undefined) return false;
    const saved = await save({ kind: 'move', id: thread.id, revision: thread.revision, anchor });
    if (saved) moving.value = null;
    return saved;
  }

  async function suggestRelocation() {
    const selection = current;
    const thread = activeThread();
    if (selection?.index === undefined || thread?.anchor.target.kind !== 'line') return;
    const sequence = ++relocateSequence;
    relocation.value = 'asking';
    error.value = '';
    try {
      const answer = await locate({ ...selection, index: selection.index }, thread.id);
      // A thread or file switch while asking makes the answer someone else's.
      if (sequence === relocateSequence && selection === current && thread === activeThread()) {
        relocation.value = answer;
      }
    } catch (failure) {
      if (sequence !== relocateSequence) return;
      relocation.value = null;
      error.value = failure instanceof Error ? failure.message : 'Could not look for a new line.';
    }
  }

  function dismissRelocation() {
    relocateSequence++;
    relocation.value = null;
  }

  /** Move the thread where the host found its text; the host refuses when that line has changed again. */
  async function confirmRelocation(anchorFor: (side: Side, line: number) => Anchor | undefined) {
    const answer = relocation.value;
    const thread = activeThread();
    if (answer === null || answer === 'asking' || answer.outcome !== 'suggestion' || thread === undefined) {
      return false;
    }
    const anchor = anchorFor(answer.side, answer.line);
    if (anchor === undefined) {
      error.value = 'Open the comment’s file to move it within that file.';
      return false;
    }
    const saved = await save({
      kind: 'move',
      id: thread.id,
      revision: thread.revision,
      anchor,
      if_text: answer.text,
    });
    relocation.value = null;
    return saved;
  }

  function edit(value: string) {
    text.value = value;
    if (activeThread() === undefined) autosave.cancel();
    else autosave();
  }

  return {
    openSourceLink,
    staleFile,
    threads,
    threadId,
    adding,
    relocation,
    suggestRelocation,
    dismissRelocation,
    confirmRelocation,
    moving,
    startMove,
    cancelMove,
    editMove,
    submitMove,
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
