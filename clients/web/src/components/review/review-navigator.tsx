import '@kerfjs/ui/list-item.css';
import '@kerfjs/ui/select/register';
import './review-navigator.css';

import { Badge } from '@kerfjs/ui/badge';
import { Button } from '@kerfjs/ui/button';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { ProgressBar } from '@kerfjs/ui/progress-bar';
import { SegmentedControl } from '@kerfjs/ui/segmented-control';
import { Select } from '@kerfjs/ui/select';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { Text } from '@kerfjs/ui/text';
import { TextField } from '@kerfjs/ui/text-field';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { TreeList, type TreeListNode } from '@kerfjs/ui/tree-list';
import { wireTreeList } from '@kerfjs/ui/wire-tree-list';
import { Check, CircleAlert, Copy, ExternalLink, FolderOpen, Link } from 'lucide';

import type { AnalysisState } from '../analysis/analysis-state.js';
import { type FileOrder, orderFiles } from './file-order.js';
import { type FileProgress, type ReviewProgress } from './review-progress.js';
import {
  type FileAction,
  gitModes,
  type ReviewFile,
  type ReviewSource,
  type ReviewSourceState,
} from './review-source.js';
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

const fileActions = [
  { action: 'copy_relative', label: 'Copy Relative Path', icon: Link, name: 'link' },
  { action: 'copy_absolute', label: 'Copy Absolute Path', icon: Copy, name: 'copy' },
  { action: 'reveal', label: 'Reveal in File Manager', icon: FolderOpen, name: 'folder-open' },
  { action: 'open', label: 'Open in Default Editor', icon: ExternalLink, name: 'external-link' },
] satisfies readonly { action: FileAction; label: string; icon: typeof Link; name: string }[];

type Folder = { folders: Map<string, Folder>; files: TreeListNode[] };

function fileTree(files: readonly ReviewFile[], filter: string, marks: ReadonlyMap<string, FileProgress>) {
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
    const mark = marks.get(file.path);
    folder.files.push({
      id: `file:${index}`,
      label: name,
      description: file.previous_path ?? undefined,
      trailing: (
        <>
          {mark === undefined ? null : (
            <Badge
              size="compact"
              tone={mark === 'reviewed' ? 'success' : 'warning'}
              title={mark === 'reviewed' ? 'Reviewed' : 'Changed Since Reviewed'}
              label={mark === 'reviewed' ? 'Reviewed' : 'Changed Since Reviewed'}
            >
              <LucideIcon
                icon={mark === 'reviewed' ? Check : CircleAlert}
                name={mark === 'reviewed' ? 'check' : 'circle-alert'}
              />
            </Badge>
          )}
          <Badge size="compact" tone={tone} title={label} label={label}>
            {letter}
          </Badge>
        </>
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

const orderChoices = [
  { value: 'path', label: 'Path' },
  { value: 'risk', label: 'Risk' },
  { value: 'narrative', label: 'Narrative' },
] satisfies readonly { value: FileOrder; label: string }[];

/** The Risk or Narrative order as sections of files (HS2-5P1B23); the path tree stays one choice away. */
function orderedTree(
  files: readonly ReviewFile[],
  order: 'risk' | 'narrative',
  analysis: AnalysisState,
  filter: string,
  marks: ReadonlyMap<string, FileProgress>,
) {
  const status = analysis.modes[order].status.value;
  const result = status?.status === 'complete' || status?.status === 'partial' ? status.result : null;
  const query = filter.trim().toLocaleLowerCase();
  const expanded: string[] = [];
  const nodes: TreeListNode[] = orderFiles(
    files.map(({ path }) => path),
    order,
    result,
  ).flatMap((section) => {
    const children = section.entries.flatMap(({ index, detail, badge }) => {
      const file = files[index];
      if (file === undefined || !file.path.toLocaleLowerCase().includes(query)) return [];
      const mark = marks.get(file.path);
      const { label, letter, tone } = statuses[file.status];
      return [
        {
          id: `file:${index}`,
          label: file.path.split('/').at(-1) ?? file.path,
          description:
            [file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '', detail]
              .filter((part) => part !== '')
              .join(' · ') || undefined,
          trailing: (
            <>
              {badge === null ? null : (
                <Badge size="compact" tone={badge.tone} title={badge.label} label={badge.label}>
                  {badge.label}
                </Badge>
              )}
              {mark === undefined ? null : (
                <Badge
                  size="compact"
                  tone={mark === 'reviewed' ? 'success' : 'warning'}
                  title={mark === 'reviewed' ? 'Reviewed' : 'Changed Since Reviewed'}
                  label={mark === 'reviewed' ? 'Reviewed' : 'Changed Since Reviewed'}
                >
                  <LucideIcon
                    icon={mark === 'reviewed' ? Check : CircleAlert}
                    name={mark === 'reviewed' ? 'check' : 'circle-alert'}
                  />
                </Badge>
              )}
              <Badge size="compact" tone={tone} title={label} label={label}>
                {letter}
              </Badge>
            </>
          ),
        } satisfies TreeListNode,
      ];
    });
    if (children.length === 0) return [];
    const id = `folder:order:${section.id}`;
    expanded.push(id);
    return [{ id, label: section.label, children } satisfies TreeListNode];
  });
  return { nodes, expanded, status, result };
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
      {state.error.value === '' ? null : <StateBanner tone="danger" urgency="alert" title={state.error.value} />}
    </form>
  );
}

export function ReviewNavigator({
  id,
  state,
  progress,
  ordering,
}: {
  id: string;
  state: ReviewSourceState;
  /** Per-file review marks and the control that sets them; absent where marking is not offered (HS2-FTEQVQ). */
  progress?: ReviewProgress;
  /** The file order and the analysis behind the Risk and Narrative views; absent where ordering is not offered. */
  ordering?: { order: { readonly value: FileOrder }; analysis: AnalysisState };
}) {
  const review = state.review.value;
  const filter = state.filter.value;
  const marks = progress?.files.value ?? new Map<string, FileProgress>();
  const order = ordering?.order.value ?? 'path';
  const ordered =
    ordering === undefined || order === 'path'
      ? null
      : orderedTree(review?.files ?? [], order, ordering.analysis, filter, marks);
  const tree = ordered ?? fileTree(review?.files ?? [], filter, marks);
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
          {progress === undefined || review.files.length === 0 ? null : (
            <ProgressBar
              size="compact"
              tone="success"
              label="Files Reviewed"
              value={progress.reviewedCount()}
              max={review.files.length}
              valueText={`${progress.reviewedCount()} of ${review.files.length}`}
              showValue
            />
          )}
          {ordering === undefined || review.files.length === 0 ? null : (
            <SegmentedControl
              id={`${id}-order`}
              label="Order Files"
              action="review-file-order"
              choices={orderChoices}
              value={order}
              size="compact"
            />
          )}
          {ordered === null || ordering === undefined ? null : ordered.status === null ||
            ordered.status.status === 'running' ? (
            <Text role="status" flush>{`Working out the ${order} order…`}</Text>
          ) : ordered.result === null ? (
            <StateBanner
              tone="warning"
              title="Order Unavailable"
              detail={'message' in ordered.status ? ordered.status.message : 'The analysis did not finish.'}
            />
          ) : (ordered.result.failures?.length ?? 0) > 0 ? (
            <Text role="status" flush>
              Some files could not be analyzed and are listed apart.
            </Text>
          ) : null}
          {selection === undefined ? null : (
            <>
              <ToolbarControlGroup label="Selected File Actions" content="icon">
                {progress === undefined ? null : (
                  <ToolbarButton
                    action="review-progress-toggle"
                    pressed={marks.get(review.files[selection]?.path ?? '') === 'reviewed'}
                    disabled={!progress.ready()}
                    ariaLabel="Mark Reviewed"
                    title="Mark Reviewed"
                    icon={<LucideIcon icon={Check} name="check" />}
                  />
                )}
                {fileActions.map(({ action, label, icon, name }) => (
                  <ToolbarButton
                    action={`review-file-action:${action}`}
                    ariaLabel={label}
                    title={label}
                    disabled={
                      state.activeSource.value === null ||
                      (state.activeSource.value.kind === 'difftool' && action !== 'copy_relative')
                    }
                    icon={<LucideIcon icon={icon} name={name} />}
                  />
                ))}
              </ToolbarControlGroup>
              {state.activeSource.value?.kind === 'difftool' ? (
                <Text flush>Git difftool inputs do not identify a live file.</Text>
              ) : null}
              <Text role="status" flush>
                {state.fileActionStatus.value}
              </Text>
            </>
          )}
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
  {
    wireKeyboard = true,
    onFileSelect,
    onToggleReviewed,
    onOrder,
  }: {
    wireKeyboard?: boolean;
    /** Marks the selected file reviewed, or clears its mark (HS2-FTEQVQ). */
    onToggleReviewed?: () => void;
    /** Called with the order chosen in the Order Files control (HS2-5P1B23). */
    onOrder?: (order: FileOrder) => void;
    /** Called each time a changed file is chosen, including the file that is already selected. */
    onFileSelect?: (index: number) => void;
  } = {},
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
      if (action === 'review-progress-toggle') onToggleReviewed?.();
      if (action === 'review-file-order') {
        const value = control.dataset.segmentValue;
        if (value === 'path' || value === 'risk' || value === 'narrative') onOrder?.(value);
      }
      const fileAction = fileActions.find((item) => action === `review-file-action:${item.action}`);
      if (fileAction !== undefined) void state.runFileAction(fileAction.action);
      const rowId = control.dataset.itemId ?? control.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
      if (rowId === undefined) return;
      if (action === 'review-file-select' && rowId.startsWith('file:')) {
        state.fileActionStatus.value = '';
        const index = Number(rowId.slice('file:'.length));
        state.selected.value = index;
        onFileSelect?.(index);
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
