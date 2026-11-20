import '@kerfjs/ui/list-item.css';
import '@kerfjs/ui/select/register';
import './review-navigator.css';

import { Badge } from '@kerfjs/ui/badge';
import { Button } from '@kerfjs/ui/button';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { Select } from '@kerfjs/ui/select';
import { TextField } from '@kerfjs/ui/text-field';
import { TreeList, type TreeListNode } from '@kerfjs/ui/tree-list';
import { wireTreeList } from '@kerfjs/ui/wire-tree-list';

import { gitModes, type ReviewFile, type ReviewSource, type ReviewSourceState } from './review-source.js';
import { SourceContext } from './source-context.js';

const sourceOptions = [
  { value: 'git', label: 'Git Repository' },
  { value: 'paths', label: 'Files or Folders' },
] as const;

const statuses = {
  added: { letter: 'A', label: 'Added', tone: 'success' },
  copied: { letter: 'C', label: 'Copied', tone: 'neutral' },
  deleted: { letter: 'D', label: 'Deleted', tone: 'danger' },
  modified: { letter: 'M', label: 'Modified', tone: 'neutral' },
  renamed: { letter: 'R', label: 'Renamed', tone: 'neutral' },
  type_changed: { letter: 'T', label: 'Type Changed', tone: 'neutral' },
  unmerged: { letter: 'U', label: 'Unmerged', tone: 'warning' },
} as const;

type Folder = { folders: Map<string, Folder>; files: TreeListNode[] };

function fileTree(files: readonly ReviewFile[], filter: string) {
  const expanded: string[] = [];
  const root: Folder = { folders: new Map(), files: [] };
  const query = filter.trim().toLocaleLowerCase();
  files.forEach((file, index) => {
    if (
      !file.path.toLocaleLowerCase().includes(query) &&
      file.previous_path?.toLocaleLowerCase().includes(query) !== true
    )
      return;
    const parts = file.path.split('/');
    const name = parts.pop() ?? file.path;
    let folder = root;
    for (const part of parts) {
      let child = folder.folders.get(part);
      if (child === undefined) {
        child = { folders: new Map(), files: [] };
        folder.folders.set(part, child);
      }
      folder = child;
    }
    const { label, letter, tone } = statuses[file.status];
    folder.files.push({
      id: `file:${index}`,
      label: name,
      description: file.previous_path ?? undefined,
      trailing: (
        <Badge size="compact" tone={tone} title={label} label={label}>
          {letter}
        </Badge>
      ),
    });
  });

  function nodes(folder: Folder, prefix: string): TreeListNode[] {
    const folders = [...folder.folders.entries()].map(([name, child]) => {
      const path = `${prefix}/${name}`;
      const id = `folder:${path}`;
      expanded.push(id);
      return { id, label: name, children: nodes(child, path) };
    });
    return [...folders, ...folder.files];
  }
  return { nodes: nodes(root, ''), expanded };
}

function SourceForm({ state }: { state: ReviewSourceState }) {
  const field = (name: string, label: string) => (
    <TextField
      name={name}
      label={label}
      required
      autocomplete="off"
      spellcheck={false}
      value={state.fields.value[name] ?? ''}
    />
  );
  return (
    <form class="review-navigator__form" data-review-source-form="">
      <Select name="source-kind" label="Compare" choices={sourceOptions} value={state.sourceKind.value} />
      {state.sourceKind.value === 'paths' ? (
        <>
          {field('before-path', 'Before Path')}
          {field('after-path', 'After Path')}
        </>
      ) : (
        <>
          {field('repository', 'Repository Path')}
          <Select name="git-mode" label="Git Changes" choices={gitModes} value={state.gitMode.value} />
          {state.gitMode.value === 'range' ? (
            <>
              {field('from-revision', 'From Revision')}
              {field('to-revision', 'To Revision')}
            </>
          ) : null}
          {state.gitMode.value === 'commit' || state.gitMode.value === 'branch' ? field('revision', 'Revision') : null}
        </>
      )}
      <Button
        type="submit"
        tone="brand"
        emphasis="primary"
        loading={state.pending.value}
        disabled={state.pending.value}
      >
        Open Comparison
      </Button>
      {state.error.value === '' ? null : <p role="alert">{state.error.value}</p>}
    </form>
  );
}

export function ReviewNavigator({ id, state }: { id: string; state: ReviewSourceState }) {
  const review = state.review.value;
  const filter = state.filter.value;
  const tree = fileTree(review?.files ?? [], filter);
  const selection = state.selected.value;
  return (
    <div class="review-navigator" id={id}>
      {review === null ? null : (
        <div class="review-navigator__source">
          <SourceContext identity={review.branch ?? review.identity} comparison={review.comparison} />
          <Button size="compact" emphasis="plain" tone="brand" action="review-source-toggle">
            {state.formOpen.value ? 'Hide Source Options' : 'Change Source'}
          </Button>
        </div>
      )}
      {state.formOpen.value ? <SourceForm state={state} /> : null}
      {review === null ? null : (
        <div class="review-navigator__files">
          {review.files.length > 0 ? (
            <TextField
              type="search"
              size="compact"
              ariaLabel="Filter Changed Files"
              name="review-filter"
              placeholder="Filter Changed Files"
              value={filter}
            />
          ) : null}
          {tree.nodes.length === 0 ? (
            <EmptyState title={review.files.length === 0 ? 'No Changed Files' : 'No Matching Files'} />
          ) : (
            <TreeList
              id={`${id}-files`}
              label="Changed Files"
              nodes={tree.nodes}
              expanded={tree.expanded.filter((folder) => !state.collapsed.value.has(folder))}
              selected={selection === undefined ? undefined : `file:${selection}`}
              action="review-file-select"
              toggleAction="review-folder-toggle"
              density="compact"
            />
          )}
        </div>
      )}
    </div>
  );
}

export function wireReviewNavigator(
  root: HTMLElement,
  id: string,
  state: ReviewSourceState,
  { wireKeyboard = true } = {},
) {
  const stopTree = wireKeyboard ? wireTreeList(root) : undefined;
  const controller = new AbortController();
  const { signal } = controller;
  const scope = (target: EventTarget | null): target is HTMLElement =>
    target instanceof HTMLElement && target.closest('.review-navigator')?.id === id;

  root.addEventListener(
    'input',
    (event) => {
      const target = event.target;
      if (!scope(target) || !(target instanceof HTMLInputElement)) return;
      if (target.name === 'review-filter') state.filter.value = target.value;
      else state.fields.value = { ...state.fields.value, [target.name]: target.value };
    },
    { signal },
  );

  root.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (!scope(target) || target.tagName !== 'KUI-SELECT' || !('value' in target)) return;
      const value = target.value;
      if (target.getAttribute('name') === 'source-kind' && (value === 'git' || value === 'paths')) {
        state.sourceKind.value = value;
      }
      const mode = gitModes.find((item) => item.value === value);
      if (target.getAttribute('name') === 'git-mode' && mode !== undefined) state.gitMode.value = mode.value;
    },
    { signal },
  );

  root.addEventListener(
    'submit',
    (event) => {
      const target = event.target;
      if (!scope(target) || !(target instanceof HTMLFormElement)) return;
      event.preventDefault();
      const values = state.fields.value;
      const source: ReviewSource =
        state.sourceKind.value === 'paths'
          ? { kind: 'paths', before: values['before-path'] ?? '', after: values['after-path'] ?? '' }
          : {
              kind: 'git',
              directory: values.repository ?? '',
              mode: {
                kind: state.gitMode.value,
                revision: values.revision,
                before: values['from-revision'],
                after: values['to-revision'],
              },
            };
      void state.open(source);
    },
    { signal },
  );

  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest<HTMLElement>('[data-action]');
      if (!scope(control)) return;
      const action = control.dataset.action;
      if (action === 'review-source-toggle') state.formOpen.value = !state.formOpen.value;
      const rowId = control.dataset.itemId ?? control.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
      if (rowId === undefined) return;
      if (action === 'review-file-select' && rowId.startsWith('file:')) {
        state.selected.value = Number(rowId.slice('file:'.length));
      } else if (
        (action === 'review-folder-toggle' || action === 'review-file-select') &&
        rowId.startsWith('folder:')
      ) {
        const collapsed = new Set(state.collapsed.value);
        if (collapsed.has(rowId)) collapsed.delete(rowId);
        else collapsed.add(rowId);
        state.collapsed.value = collapsed;
      }
    },
    { signal },
  );

  return () => {
    controller.abort();
    stopTree?.();
  };
}
