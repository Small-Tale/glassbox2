import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import '@kerfjs/ui/list-item.css';
import './review.css';

import { Badge } from '@kerfjs/ui/badge';
import { Button } from '@kerfjs/ui/button';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { SegmentedControl } from '@kerfjs/ui/segmented-control';
import { TextField } from '@kerfjs/ui/text-field';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { ToolbarText } from '@kerfjs/ui/toolbar-text';
import { TreeList, type TreeListNode } from '@kerfjs/ui/tree-list';
import { wireTreeList } from '@kerfjs/ui/wire-tree-list';
import { wireWorkbench } from '@kerfjs/ui/wire-workbench';
import { Workbench } from '@kerfjs/ui/workbench';
import { mount, signal } from 'kerfjs';
import { Columns2, Compass, Rows2, Share2, ShieldAlert, WrapText } from 'lucide';

const files = {
  'src/bundle.ts': [
    'export async function writeBundle(review: Review) {',
    '  const path = bundlePath(review.id);',
    '-  await writeFile(path, serialize(review));',
    '+  const temporary = path + ".tmp";',
    '+  await writeFile(temporary, serialize(review));',
    '+  await rename(temporary, path);',
    '  return path;',
    '}',
    '',
    'export function bundlePath(id: string) {',
    '  return join(bundleDirectory, id, "review.md");',
    '}',
  ],
  'src/settings.ts': [' export const defaults = {', '-  theme: "light",', '+  theme: "system",', ' };'],
  'tests/bundle.test.ts': [
    '+test("a bundle is readable after writing", async () => {',
    '+  const path = await writeBundle(review);',
    '+  assert.match(await readFile(path, "utf8"), /Feedback/);',
    '+});',
  ],
  'README.md': ['+# Fieldnotes', '+Review feedback is written to a local bundle.'],
} as const;

type File = keyof typeof files;
const active = signal<File>('src/bundle.ts');
const left = signal(false);
const right = signal(false);
const expanded = signal(['src', 'tests']);
const split = signal(true);
const wrap = signal(true);
const risk = signal(false);
const guidance = signal(false);
type Thread = {
  id: string;
  kind: 'comment' | 'ai';
  label: string;
  tone: 'neutral' | 'info' | 'warning';
  text: string;
  replies: { author: string; text: string }[];
};
const threads = signal<Thread[]>([
  {
    id: 'name',
    kind: 'comment',
    label: 'Style',
    tone: 'neutral',
    text: 'The variable name is too vague here.',
    replies: [
      { author: 'Reviewer', text: 'Use temporaryBundlePath so its purpose is clear.' },
      { author: 'You', text: 'Agreed. That also reads better at the rename call.' },
    ],
  },
  {
    id: 'tests',
    kind: 'comment',
    label: 'Fix needed',
    tone: 'warning',
    text: 'Add a test for simultaneous saves.',
    replies: [],
  },
  {
    id: 'risk',
    kind: 'ai',
    label: 'Medium risk',
    tone: 'warning',
    text: 'Two saves can resolve to the same temporary filename.',
    replies: [{ author: 'Reviewer', text: 'A unique name per write would avoid the collision.' }],
  },
  {
    id: 'proof',
    kind: 'ai',
    label: 'Rationale',
    tone: 'info',
    text: 'Renaming into place keeps readers from seeing a partial bundle.',
    replies: [],
  },
]);
const selectedThread = signal<string | null>('name');
const replyDraft = signal('');
let nextThread = 1;
const currentThread = () => threads.value.find((thread) => thread.id === selectedThread.value);
const countThreads = (kind: Thread['kind']) => threads.value.filter((thread) => thread.kind === kind).length;
const countLabel = (count: number, label: string, plural = label + 's') =>
  `${String(count)} ${count === 1 ? label : plural}`;

function updateThread(id: string, patch: Partial<Thread>) {
  threads.value = threads.value.map((thread) => (thread.id === id ? { ...thread, ...patch } : thread));
}

function openThread(id: string) {
  selectedThread.value = id;
  replyDraft.value = '';
  right.value = false;
}

const destination = signal<'new' | 'existing'>('new');
const exportTitle = signal('Review feedback for Fieldnotes');
const ticket = signal('');
const project = signal('Fieldnotes');
const summary = signal('');
const status = signal('');

function file(id: File, change: string): TreeListNode {
  return {
    id,
    label: id.split('/').at(-1) ?? id,
    trailing: (
      <Badge size="compact" tone={change === 'A' ? 'success' : 'neutral'}>
        {change}
      </Badge>
    ),
  };
}

const nodes: TreeListNode[] = [
  { id: 'src', label: 'src', children: [file('src/bundle.ts', 'M'), file('src/settings.ts', 'M')] },
  { id: 'tests', label: 'tests', children: [file('tests/bundle.test.ts', 'A')] },
  file('README.md', 'M'),
];

function LineThreads() {
  return (
    <section class="line-threads" aria-label="Feedback on Line 23">
      {threads.value.map((thread) => (
        <article
          class="thread-preview"
          data-active={String(thread.id === selectedThread.value && !right.value)}
          data-risk={String(risk.value && thread.id === 'risk')}
        >
          <button
            type="button"
            class="thread-preview-button"
            data-action="thread"
            data-thread={thread.id}
            aria-pressed={thread.id === selectedThread.value && !right.value}
          >
            <span class="thread-meta">
              <strong>{thread.kind === 'ai' ? 'AI note' : 'Reviewer'}</strong>
              <Badge tone={thread.tone} size="compact">
                {thread.label}
              </Badge>
              {thread.replies.length > 0 && (
                <span class="muted">
                  {thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}
                </span>
              )}
            </span>
            <span class="thread-message">{thread.text || 'New comment'}</span>
            {thread.replies[0] !== undefined && <span class="thread-reply-preview">{thread.replies[0].text}</span>}
          </button>
        </article>
      ))}
      <Button size="compact" emphasis="plain" tone="brand" action="add-comment">
        Add Comment
      </Button>
    </section>
  );
}

type DiffLine = { number: number; text: string; change?: 'added' | 'removed' };

function Diff() {
  const rows: { before?: DiffLine; after?: DiffLine }[] = [];
  let oldNumber = 20;
  let newNumber = 20;
  for (const line of files[active.value]) {
    if (line.startsWith('-')) {
      rows.push({ before: { number: ++oldNumber, text: line.slice(1), change: 'removed' } });
    } else if (line.startsWith('+')) {
      const after: DiffLine = { number: ++newNumber, text: line.slice(1), change: 'added' };
      const previous = rows.at(-1);
      if (split.value && previous?.before?.change === 'removed' && previous.after === undefined) {
        previous.after = after;
      } else {
        rows.push({ after });
      }
    } else {
      rows.push({ before: { number: ++oldNumber, text: line }, after: { number: ++newNumber, text: line } });
    }
  }
  const isBundle = active.value === 'src/bundle.ts';
  return (
    <section
      class="diff-surface"
      data-wrap={String(wrap.value)}
      aria-label={split.value ? 'Side-by-side diff' : 'Inline diff'}
    >
      {guidance.value && (
        <aside class="inline-guidance" aria-label="Code Guidance">
          <Badge tone="info" size="compact">
            Code Guidance
          </Badge>
          <span>Start with the temporary filename. Check that simultaneous saves use different paths.</span>
        </aside>
      )}
      {split.value && (
        <div class="diff-columns">
          <span>Before</span>
          <span>After</span>
        </div>
      )}
      <div class="hunk">{isBundle ? '@@ −21,10 +21,12 @@ writeBundle' : '@@ File changes @@'}</div>
      {rows.map(({ before, after }) => {
        const anchor = isBundle && after?.number === 23;
        const renderCell = (line: DiffLine | undefined) => (
          <div class="diff-cell" data-change={line?.change}>
            <span class="line-number">{!split.value && line?.change === 'removed' ? '' : line?.number}</span>
            <span aria-hidden="true">{line?.change === 'added' ? '+' : line?.change === 'removed' ? '−' : ''}</span>
            <code>{line?.text ?? ' '}</code>
          </div>
        );
        return (
          <div class="diff-entry">
            {split.value ? (
              <div class="diff-columns">
                {renderCell(before)}
                {renderCell(after)}
              </div>
            ) : (
              <div class="diff-inline" data-change={after?.change ?? before?.change}>
                <span class="line-number">{before?.number}</span>
                {renderCell(after ?? before)}
              </div>
            )}
            {anchor && <LineThreads />}
          </div>
        );
      })}
    </section>
  );
}

function Inspector() {
  const thread = currentThread();
  if (thread === undefined) {
    return (
      <section class="review-stack">
        <p class="muted">Select a comment or AI note in the diff.</p>
      </section>
    );
  }
  return (
    <section class="review-stack" aria-label="Selected Discussion">
      <div class="review-meta">
        <Badge tone={thread.tone} size="compact">
          {thread.label}
        </Badge>
        <span>src/bundle.ts · Line 23</span>
      </div>
      {thread.kind === 'ai' ? (
        <p>{thread.text}</p>
      ) : (
        <>
          <TextField label="Comment" name="comment" multiline rows={3} value={thread.text} />
          <div class="review-meta inspector-actions">
            <p class="muted">Saves automatically</p>
            <Button size="compact" tone="danger" emphasis="plain" action="remove">
              Remove
            </Button>
          </div>
        </>
      )}
      {thread.replies.length > 0 && (
        <ol class="thread-replies" aria-label="Replies">
          {thread.replies.map(({ author, text }) => (
            <li>
              <strong>{author}</strong>
              <p>{text}</p>
            </li>
          ))}
        </ol>
      )}
      <TextField label="Reply" name="reply" multiline rows={2} value={replyDraft.value} />
      <div class="reply-action">
        <Button
          size="compact"
          tone="brand"
          emphasis="secondary"
          action="post-reply"
          disabled={replyDraft.value.trim() === ''}
        >
          Post Reply
        </Button>
      </div>
    </section>
  );
}

const recent = [
  { id: 'FN-4QX8M2', title: 'Make review bundle writes atomic', state: 'Started' },
  { id: 'FN-7D2PK9', title: 'Keep review bundles after closing the app', state: 'Not started' },
  { id: 'FN-2JMA6V', title: 'Verify simultaneous feedback saves', state: 'Not started' },
] as const;

function ExportDialog() {
  const existing = destination.value === 'existing';
  const blocked = existing ? ticket.value.trim() === '' : exportTitle.value.trim() === '';
  return (
    <dialog id="hot-sheet-export" class="export-dialog" aria-labelledby="export-title">
      <div class="export-shell">
        <header class="export-header">
          <h2 id="export-title">Send to Hot Sheet 2</h2>
        </header>
        <div class="export-content">
          <section class="export-section">
            <h3>Hot Sheet project</h3>
            <div class="export-group project-row">
              <div>
                <strong>{project.value}</strong>
                <p class="muted">Hot Sheet project store</p>
              </div>
              <Button size="compact" emphasis="plain" tone="brand" action="project">
                Change
              </Button>
            </div>
          </section>
          <section class="export-section">
            <h3>Ticket</h3>
            <div class="export-group">
              <div class="ticket-mode">
                <span>Send as</span>
                <SegmentedControl
                  id="destination"
                  label="Ticket destination"
                  value={destination.value}
                  action="destination"
                  choices={[
                    { value: 'new', label: 'New Ticket' },
                    { value: 'existing', label: 'Add to Existing Ticket' },
                  ]}
                />
              </div>
              {existing ? (
                <div class="ticket-target">
                  <div class="ticket-input">
                    <TextField
                      label="Ticket"
                      name="ticket"
                      value={ticket.value}
                      placeholder="Enter a ticket ID or paste a reference"
                    />
                    <Button size="compact" emphasis="plain" tone="brand" action="recent">
                      Recent
                    </Button>
                  </div>
                  <p class="muted">Adds the feedback bundle as a note on the selected ticket.</p>
                </div>
              ) : (
                <TextField
                  label="Title"
                  name="title"
                  value={exportTitle.value}
                  hint="This becomes the new ticket’s title."
                />
              )}
            </div>
          </section>
          <section class="export-section">
            <h3>Review</h3>
            <div class="export-group">
              <TextField
                label="Summary"
                name="summary"
                value={summary.value}
                placeholder="Optional overall notes (Markdown)"
                multiline
                rows={3}
              />
            </div>
          </section>
          <section class="export-section">
            <h3>Included feedback</h3>
            <div class="export-group">
              <p>{countLabel(countThreads('comment'), 'line comment')} · src/bundle.ts</p>
              <p>
                {countLabel(
                  threads.value.reduce((count, thread) => count + thread.replies.length, 0),
                  'thread reply',
                  'thread replies',
                )}
              </p>
            </div>
          </section>
        </div>
        <footer class="export-actions">
          <Button emphasis="secondary" action="cancel-export">
            Cancel
          </Button>
          <p class="muted">{blocked ? (existing ? 'Choose a ticket' : 'Enter a title') : 'Feedback bundle included'}</p>
          <Button tone="brand" action="send-export" disabled={blocked}>
            {existing ? 'Add to ticket' : 'Create ticket'}
          </Button>
        </footer>
      </div>
      <div id="project-picker" popover="auto" class="recent-tickets" aria-label="Choose Hot Sheet project">
        <h3>Hot Sheet projects</h3>
        {['Fieldnotes', 'Fieldnotes Tools'].map((name) => (
          <button type="button" class="recent-ticket" data-action="pick-project" data-project={name}>
            {name}
          </button>
        ))}
      </div>
      {existing && (
        <div id="recent-tickets" popover="auto" class="recent-tickets" aria-label="Recent tickets">
          <h3>Recent tickets</h3>
          <p class="muted">{project.value} · Newest first</p>
          {recent.map(({ id, title, state }) => (
            <button type="button" class="recent-ticket" data-action="pick-ticket" data-ticket={id}>
              <strong>{title}</strong>
              <span class="muted">
                {id} · {state}
              </span>
            </button>
          ))}
        </div>
      )}
    </dialog>
  );
}

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

mount(root, () => (
  <div class="review-shell">
    <Workbench
      id="review"
      label="Code Review Workbench"
      mainLabel="Comparison"
      mainToolbar={{
        label: 'Comparison',
        title: (
          <ToolbarText text={active.value.split('/').at(-1) ?? active.value} size="xlarge-fixed" headingLevel={1} />
        ),
        responsive: 'wrap',
        trailing: (
          <>
            <ToolbarControlGroup label="Diff Layout" content="icon">
              <ToolbarButton
                action="split"
                pressed={split.value}
                ariaLabel="Side by side"
                title="Side by side"
                icon={<LucideIcon icon={Columns2} name="columns-2" />}
              />
              <ToolbarButton
                action="inline"
                pressed={!split.value}
                ariaLabel="Inline"
                title="Inline"
                icon={<LucideIcon icon={Rows2} name="rows-2" />}
              />
              <ToolbarButton
                action="wrap"
                pressed={wrap.value}
                ariaLabel="Wrap"
                title="Wrap"
                icon={<LucideIcon icon={WrapText} name="wrap-text" />}
              />
            </ToolbarControlGroup>
            <ToolbarControlGroup label="Risk Analysis" content="icon">
              <ToolbarButton
                action="risk"
                pressed={risk.value}
                ariaLabel="Risk Analysis"
                title="Risk Analysis"
                icon={<LucideIcon icon={ShieldAlert} name="shield-alert" />}
              />
            </ToolbarControlGroup>
            <ToolbarControlGroup label="Code Guidance" content="icon">
              <ToolbarButton
                action="guidance"
                pressed={guidance.value}
                ariaLabel="Code Guidance"
                title="Code Guidance"
                icon={<LucideIcon icon={Compass} name="compass" />}
              />
            </ToolbarControlGroup>
          </>
        ),
      }}
      main={<Diff />}
      mainBottomToolbar={{
        label: 'Review Actions',
        leading: (
          <ToolbarText
            size="small"
            text={status.value || `4 changed files · ${countLabel(countThreads('comment'), 'comment')}`}
          />
        ),
        trailing: (
          <ToolbarControlGroup label="Share Feedback" content="icon" appearance="borderless" single>
            <ToolbarButton
              action="share"
              ariaHasPopup="dialog"
              ariaLabel="Share Feedback…"
              title="Share Feedback…"
              icon={<LucideIcon icon={Share2} name="share-2" />}
            />
          </ToolbarControlGroup>
        ),
      }}
      leftRail={{
        label: 'Changed Files',
        size: 236,
        responsiveOverlayAt: 730,
        collapsed: left.value,
        toolbar: {
          label: 'Changed Files',
          title: <ToolbarText text="Fieldnotes" size="xlarge-fixed" headingLevel={2} />,
          toggle: { name: 'Files', action: 'files' },
        },
        content: (
          <div>
            <div class="branch-context">
              <strong>feature/review-bundles</strong>
              <span class="muted">Working tree</span>
            </div>
            <TreeList
              id="review-files"
              label="Changed Files"
              density="compact"
              nodes={nodes}
              selected={active.value}
              expanded={expanded.value}
              action="file"
              toggleAction="folder"
            />
          </div>
        ),
      }}
      rightRail={{
        label: 'Inspector',
        size: 302,
        responsiveOverlayAt: 1080,
        collapsed: right.value,
        toolbar: {
          label: 'Inspector',
          title: (
            <ToolbarText
              text={currentThread()?.kind === 'ai' ? 'AI review note' : 'Line comment'}
              size="xlarge-fixed"
              headingLevel={2}
            />
          ),
          toggle: { name: 'Inspector', action: 'inspector' },
        },
        content: <Inspector />,
      }}
    />
    <div id="share-actions" popover="auto" class="share-actions" role="dialog" aria-label="Share Feedback">
      <Button action="export" emphasis="plain">
        Send to Hot Sheet 2…
      </Button>
      <Button action="copy" emphasis="plain">
        Copy AI Instruction
      </Button>
    </div>
    <ExportDialog />
  </div>
));

void wireWorkbench(root, { id: 'review', panels: { leftRail: { collapsed: left }, rightRail: { collapsed: right } } });
void wireTreeList(root);

root.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action]') : null;
  if (!target) return;
  const id = target.dataset.itemId ?? target.closest<HTMLElement>('[data-item-id]')?.dataset.itemId;
  const dialog = root.querySelector<HTMLDialogElement>('#hot-sheet-export');
  const share = root.querySelector<HTMLElement>('#share-actions');
  const recentList = root.querySelector<HTMLElement>('#recent-tickets');
  switch (target.dataset.action ?? '') {
    case 'files':
      left.value = !left.value;
      break;
    case 'inspector':
      right.value = !right.value;
      break;
    case 'file':
      if (id !== undefined && Object.hasOwn(files, id)) {
        active.value = id as File;
        if (innerWidth < 730) left.value = true;
      }
      break;
    case 'folder':
      if (id !== undefined)
        expanded.value = expanded.value.includes(id)
          ? expanded.value.filter((item) => item !== id)
          : [...expanded.value, id];
      break;
    case 'split':
      split.value = true;
      break;
    case 'inline':
      split.value = false;
      break;
    case 'wrap':
      wrap.value = !wrap.value;
      break;
    case 'risk':
      risk.value = !risk.value;
      break;
    case 'guidance':
      guidance.value = !guidance.value;
      break;
    case 'thread':
      if (target.dataset.thread !== undefined) openThread(target.dataset.thread);
      break;
    case 'add-comment': {
      const threadId = `new-${String(nextThread++)}`;
      threads.value = [
        ...threads.value,
        { id: threadId, kind: 'comment', label: 'Note', tone: 'neutral', text: '', replies: [] },
      ];
      openThread(threadId);
      break;
    }
    case 'remove':
      threads.value = threads.value.filter((thread) => thread.id !== selectedThread.value);
      selectedThread.value = null;
      right.value = true;
      break;
    case 'post-reply': {
      const thread = currentThread();
      const message = replyDraft.value.trim();
      if (thread !== undefined && message !== '') {
        updateThread(thread.id, { replies: [...thread.replies, { author: 'You', text: message }] });
        replyDraft.value = '';
      }
      break;
    }
    case 'share':
      share?.togglePopover({ source: target });
      break;
    case 'export':
      share?.hidePopover();
      destination.value = 'new';
      dialog?.showModal();
      break;
    case 'copy':
      share?.hidePopover();
      void navigator.clipboard.writeText('Read the Fieldnotes review bundle and apply its feedback.').then(
        () => {
          status.value = 'Example instruction copied';
        },
        () => {
          status.value = 'Clipboard unavailable';
        },
      );
      break;
    case 'destination':
      destination.value = target.dataset.segmentValue === 'existing' ? 'existing' : 'new';
      break;
    case 'project':
      root.querySelector<HTMLElement>('#project-picker')?.togglePopover({ source: target });
      break;
    case 'pick-project':
      project.value = target.dataset.project ?? project.value;
      ticket.value = '';
      root.querySelector<HTMLElement>('#project-picker')?.hidePopover();
      break;
    case 'recent':
      recentList?.togglePopover({ source: target });
      break;
    case 'pick-ticket':
      ticket.value = target.dataset.ticket ?? '';
      recentList?.hidePopover();
      break;
    case 'cancel-export':
      dialog?.close();
      break;
    case 'send-export':
      dialog?.close();
      status.value = 'Preview: feedback would be sent';
      break;
  }
});

root.addEventListener('input', (event) => {
  const field = event.target;
  if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
  switch (field.name) {
    case 'comment':
      if (selectedThread.value !== null) updateThread(selectedThread.value, { text: field.value });
      break;
    case 'reply':
      replyDraft.value = field.value;
      break;
    case 'summary':
      summary.value = field.value;
      break;
    case 'ticket':
      ticket.value = field.value;
      break;
    case 'title':
      exportTitle.value = field.value;
      break;
  }
});
