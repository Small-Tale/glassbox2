import './discussion.css';
import '@kerfjs/ui/select/register';

import { Badge } from '@kerfjs/ui/badge';
import { Button } from '@kerfjs/ui/button';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { FilePickerTrigger } from '@kerfjs/ui/file-picker';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { Select } from '@kerfjs/ui/select';
import { TextField } from '@kerfjs/ui/text-field';
import { wireFilePickers } from '@kerfjs/ui/wire-file-pickers';
import { MessageSquarePlus } from 'lucide';

import type { Definition } from '../review/definition-navigation.js';
import {
  type Anchor,
  categories,
  type DiscussionState,
  isDiagramAttachment,
  type Side,
  sourceLinkParts,
  type Thread,
} from './discussion-state.js';
import { RelocationOffer } from './relocation-offer.js';

const moveSides = [
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
] as const;

function ThreadLabels({ thread }: { thread: Thread }) {
  const origin = thread.origin;
  if (origin.kind === 'reviewer') {
    return (
      <Badge size="compact">
        {categories.find(({ value }) => value === origin.category)?.label ?? origin.category}
      </Badge>
    );
  }
  return (
    <>
      {origin.risk === null ? null : (
        <Badge size="compact" tone={origin.risk === 'high' ? 'danger' : 'warning'}>
          {`${origin.risk[0]?.toUpperCase() ?? ''}${origin.risk.slice(1)} risk`}
        </Badge>
      )}
      {origin.tags
        .filter((tag) => origin.risk === null || tag !== 'Risk Analysis')
        .map((tag) => (
          <Badge size="compact">{tag}</Badge>
        ))}
    </>
  );
}

export function LineCommentAction({ side, line }: { side: Anchor['side']; line: number }) {
  const label = `Add Comment to ${side === 'before' ? 'Before' : 'After'} Line ${line}`;
  return (
    <Button
      size="compact"
      emphasis="plain"
      action={`discussion-add:${side}:${line}`}
      title={label}
      ariaLabel={label}
      icon={<LucideIcon icon={MessageSquarePlus} name="message-square-plus" />}
    />
  );
}

export function LineDiscussion({
  threads,
  active,
  highlightRisk = false,
}: {
  threads: Thread[];
  active: number | null;
  highlightRisk?: boolean;
}) {
  if (threads.length === 0) return null;
  return (
    <div class="discussion-inline">
      {threads.map((thread) => (
        <button
          class="discussion-inline__thread"
          type="button"
          data-action={`discussion-show:${thread.id}`}
          aria-pressed={active === thread.id ? 'true' : 'false'}
          data-risk-highlighted={
            highlightRisk && thread.origin.kind === 'ai' && thread.origin.risk !== null ? 'true' : undefined
          }
        >
          <span class="discussion-inline__meta">
            <strong>{thread.opening.author}</strong>
            <ThreadLabels thread={thread} />
            {thread.replies.length === 0 ? null : (
              <span>
                {thread.replies.length} {thread.replies.length === 1 ? 'reply' : 'replies'}
              </span>
            )}
          </span>
          <span>
            {thread.origin.kind === 'ai'
              ? sourceLinkParts(thread.opening.markdown, thread.origin.related_locations ?? [])
                  .map((part) => (typeof part === 'string' ? part : part.label))
                  .join('')
              : thread.opening.markdown}
          </span>
          {thread.replies[0] === undefined ? null : (
            <span class="discussion-inline__preview">{thread.replies[0].message.markdown}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function DiscussionInspector({
  state,
  path,
  revision,
  mediaRevisions,
}: {
  state: DiscussionState;
  path?: string;
  revision?: string;
  mediaRevisions?: Partial<Record<Side, string>>;
}) {
  const thread = state.activeThread();
  const artifact = state.artifact.value;
  function attachment({ id, filename }: { id: number; filename: string }) {
    if (!isDiagramAttachment(filename)) return <p>{filename}</p>;
    return (
      <div>
        <Button action={`discussion-artifact:${id}`} emphasis="plain" tone="brand">
          {artifact?.id === id ? `Close ${filename}` : `Preview ${filename}`}
        </Button>
        {artifact?.id !== id ? null : artifact.preview === undefined ? (
          <p role="status">{artifact.message ?? 'Loading diagram…'}</p>
        ) : artifact.preview.url === undefined ? (
          <pre class="discussion-inspector__artifact-source">{artifact.preview.source}</pre>
        ) : (
          <>
            <img class="discussion-inspector__artifact" src={artifact.preview.url} alt={artifact.label} />
            <details>
              <summary>Diagram Source</summary>
              <pre class="discussion-inspector__artifact-source">{artifact.preview.source}</pre>
            </details>
          </>
        )}
      </div>
    );
  }
  const anchor = state.adding.value ?? thread?.anchor;
  const isDraft = state.adding.value !== null;
  const editable = isDraft || thread?.origin.kind === 'reviewer';
  const currentRevision = (anchor: Anchor) =>
    anchor.target.kind === 'line' ? revision : mediaRevisions?.[anchor.side];
  const stale = state.threads.value.filter(
    ({ anchor }) => anchor.path === path && anchor.revision !== currentRevision(anchor),
  );
  if (anchor === undefined) {
    const wholeImage = (['before', 'after'] as const).filter((side) => mediaRevisions?.[side] !== undefined);
    if (stale.length === 0) {
      return (
        <>
          <EmptyState title="No Discussion Selected" />
          {wholeImage.length === 0 ? null : (
            <div class="discussion-inspector__actions">
              {wholeImage.map((side) => (
                <Button action={`discussion-whole-image:${side}`} emphasis="plain" tone="brand">
                  {`Comment on Whole ${side === 'before' ? 'Before' : 'After'} Image`}
                </Button>
              ))}
            </div>
          )}
        </>
      );
    }
    return (
      <section class="discussion-inspector" aria-label="Stale Discussions">
        <p>These comments refer to an earlier version of this file.</p>
        <LineDiscussion threads={stale} active={state.threadId.value} />
      </section>
    );
  }
  const isStale = thread !== undefined && thread.anchor.revision !== currentRevision(thread.anchor);
  return (
    <section class="discussion-inspector" aria-label="Discussion">
      <div class="discussion-inline__meta">
        {thread === undefined ? null : <ThreadLabels thread={thread} />}
        <span>
          {anchor.path} · {anchor.side === 'before' ? 'Before' : 'After'}{' '}
          {anchor.target.kind === 'line' ? `line ${anchor.target.start}` : 'image region'}
        </span>
      </div>
      {isStale ? <p role="status">This comment refers to an earlier version of the file.</p> : null}
      {isStale && thread.anchor.target.kind === 'line' ? <RelocationOffer state={state} /> : null}
      {state.error.value === '' ? null : <p role="alert">{state.error.value}</p>}
      {isDraft ? <TextField name="discussion-author" label="Author" value={state.author.value} /> : null}
      {editable ? (
        <>
          <Select
            name="discussion-category"
            label="Category"
            choices={categories}
            value={thread?.origin.kind === 'reviewer' ? thread.origin.category : state.category.value}
            disabled={state.pending.value}
          />
          <TextField name="discussion-text" label="Comment" multiline rows={3} value={state.text.value} />
        </>
      ) : (
        <p>
          {thread?.origin.kind === 'ai'
            ? sourceLinkParts(thread.opening.markdown, thread.origin.related_locations ?? []).map((part) =>
                typeof part === 'string' ? (
                  part
                ) : (
                  <Button
                    action={`discussion-source-link:${part.index}`}
                    emphasis="link"
                    tone="brand"
                    disabled={isStale}
                  >
                    {part.label}
                  </Button>
                ),
              )
            : thread?.opening.markdown}
        </p>
      )}
      {isDraft ? (
        <div class="discussion-inspector__actions">
          <Button action="discussion-cancel" emphasis="plain">
            Cancel
          </Button>
          <Button
            action="discussion-submit"
            tone="brand"
            disabled={state.pending.value || state.text.value.trim() === '' || state.author.value.trim() === ''}
          >
            Add Comment
          </Button>
        </div>
      ) : (
        <>
          {thread?.opening.attachments.map(attachment)}
          <FilePickerTrigger label="Attach to Thread" pickerId="discussion-attachment" disabled={state.pending.value} />
          {editable ? (
            <div class="discussion-inspector__actions">
              <span role="status">{state.pending.value ? 'Saving…' : 'Saves automatically'}</span>
              <Button action="discussion-remove" tone="danger" emphasis="plain" disabled={state.pending.value}>
                Remove
              </Button>
            </div>
          ) : null}
          {thread?.anchor.target.kind !== 'image_region' ? null : state.regionEdit.value === null ? (
            <div class="discussion-inspector__actions" data-key="discussion-region-open">
              <Button action="discussion-region-edit" emphasis="plain" tone="brand" disabled={state.pending.value}>
                Edit Region
              </Button>
            </div>
          ) : (
            <div data-key="discussion-region-edit">
              <p role="status">Drag on the image, or use the arrow keys (Shift resizes), then press Enter to save.</p>
              <div class="discussion-inspector__actions">
                <Button action="discussion-region-cancel" emphasis="plain">
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {thread?.anchor.target.kind !== 'line' ? null : state.moving.value === null ? (
            <div class="discussion-inspector__actions" data-key="discussion-move-open">
              <Button action="discussion-move" emphasis="plain" tone="brand" disabled={state.pending.value}>
                Move Comment
              </Button>
            </div>
          ) : (
            // Keyed so the browser's morph never reuses the focused Move to Line input for the Reply fields below it.
            <div data-key="discussion-move-form">
              <Select
                name="discussion-move-side"
                label="Move to Side"
                choices={moveSides}
                value={state.moving.value.side}
                disabled={state.pending.value}
              />
              <TextField
                name="discussion-move-line"
                label="Move to Line"
                type="number"
                value={state.moving.value.line}
              />
              <div class="discussion-inspector__actions">
                <Button action="discussion-move-cancel" emphasis="plain">
                  Cancel
                </Button>
                <Button action="discussion-move-submit" tone="brand" disabled={state.pending.value}>
                  Move
                </Button>
              </div>
            </div>
          )}
          {thread?.replies.map(({ message }) => (
            <div class="discussion-inspector__reply">
              <strong>{message.author}</strong>
              <p>{message.markdown}</p>
              {message.attachments.map(attachment)}
            </div>
          ))}
          <TextField name="discussion-author" label="Reply Author" value={state.author.value} />
          <TextField name="discussion-reply" label="Reply" multiline rows={2} value={state.reply.value} />
          <div class="discussion-inspector__actions">
            <Button
              action="discussion-reply"
              tone="brand"
              disabled={state.pending.value || state.reply.value.trim() === '' || state.author.value.trim() === ''}
            >
              Post Reply
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export function wireDiscussion(
  root: HTMLElement,
  state: DiscussionState,
  anchorFor: (side: Anchor['side'], line: number) => Anchor | undefined,
  showInspector: () => void,
  reveal?: (destination: Definition) => Promise<void>,
  images?: {
    /** The anchor covering a whole image of the open file on one side, when that image exists. */
    wholeImage: (side: Side) => Anchor | undefined;
    /** Start redrawing a region on the image, from where the saved region is. */
    edit: (seed: { side: Side; bounds: { left: number; top: number; width: number; height: number } }) => void;
    cancel: () => void;
  },
) {
  const controller = new AbortController();
  const { signal } = controller;
  root.addEventListener(
    'input',
    (event) => {
      const target = event.target;
      if (target instanceof HTMLTextAreaElement) {
        if (target.name === 'discussion-text') state.edit(target.value);
        if (target.name === 'discussion-reply') state.reply.value = target.value;
      }
      if (target instanceof HTMLInputElement && target.name === 'discussion-author') state.author.value = target.value;
      if (target instanceof HTMLInputElement && target.name === 'discussion-move-line') {
        state.editMove({ line: target.value });
      }
    },
    { signal },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      const target = event.target;
      if (state.moving.value === null || !(target instanceof Element)) return;
      if (target.closest('[name="discussion-move-line"], [name="discussion-move-side"]') === null) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        state.cancelMove();
      } else if (event.key === 'Enter' && target instanceof HTMLInputElement) {
        event.preventDefault();
        void state.submitMove(anchorFor);
      }
    },
    { signal },
  );
  root.addEventListener(
    'focusout',
    (event) => {
      if (event.target instanceof HTMLTextAreaElement && event.target.name === 'discussion-text') void state.saveEdit();
    },
    { signal },
  );
  root.addEventListener(
    'change',
    (event) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.tagName === 'KUI-SELECT' &&
        target.getAttribute('name') === 'discussion-category' &&
        'value' in target
      ) {
        const category = categories.find(({ value }) => value === target.value)?.value;
        if (category === undefined) return;
        if (state.adding.value !== null) state.category.value = category;
        else void state.apply({ kind: 'categorize', category });
      }
      if (
        target instanceof HTMLElement &&
        target.tagName === 'KUI-SELECT' &&
        target.getAttribute('name') === 'discussion-move-side' &&
        'value' in target
      ) {
        if (target.value === 'before' || target.value === 'after') state.editMove({ side: target.value });
      }
    },
    { signal },
  );
  const stopPickers = wireFilePickers(root, {
    onFiles: ({ id, files }) => {
      const file = files[0];
      if (id !== 'discussion-attachment' || file === undefined) return;
      if (file.size > 50_000_000) {
        state.error.value = 'The attachment exceeds 50 MB.';
        return;
      }
      const thread = state.activeThread();
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (thread !== state.activeThread() || typeof reader.result !== 'string') return;
        const content = reader.result.slice(reader.result.indexOf(',') + 1);
        void state.attach(file.name, content);
      });
      reader.addEventListener('error', () => {
        state.error.value = 'Could not read the attachment.';
      });
      reader.readAsDataURL(file);
    },
  });
  root.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const action = event.target.closest<HTMLElement>('button[data-action]')?.dataset.action;
      if (action === undefined || !action.startsWith('discussion-')) return;
      const [kind, first, second] = action.split(':');
      if (kind === 'discussion-add' && (first === 'before' || first === 'after')) {
        const anchor = anchorFor(first, Number(second));
        if (anchor !== undefined) {
          void state.showAdd(anchor);
          showInspector();
        }
      }
      if (kind === 'discussion-show') {
        void state.showThread(Number(first));
        showInspector();
      }
      if (kind === 'discussion-cancel') state.resetEditor();
      if (kind === 'discussion-region-edit') {
        const seed = state.startRegionEdit();
        if (seed !== null) images?.edit(seed);
      }
      if (kind === 'discussion-region-cancel') {
        state.cancelRegionEdit();
        images?.cancel();
      }
      if (kind === 'discussion-whole-image' && (first === 'before' || first === 'after')) {
        const wholeImage = images?.wholeImage(first);
        if (wholeImage !== undefined) {
          void state.showAdd(wholeImage);
          showInspector();
        }
      }
      if (kind === 'discussion-relocate') void state.suggestRelocation();
      if (kind === 'discussion-relocate-dismiss') state.dismissRelocation();
      if (kind === 'discussion-relocate-confirm') void state.confirmRelocation(anchorFor);
      if (kind === 'discussion-move') state.startMove();
      if (kind === 'discussion-move-cancel') state.cancelMove();
      if (kind === 'discussion-move-submit') void state.submitMove(anchorFor);
      if (kind === 'discussion-artifact') void state.previewArtifact(Number(first));
      if (kind === 'discussion-source-link' && reveal !== undefined) void state.openSourceLink(Number(first), reveal);
      if (kind === 'discussion-submit') void state.submitComment();
      if (kind === 'discussion-reply')
        void state.apply({ kind: 'reply', author: state.author.value, markdown: state.reply.value }).then((saved) => {
          if (saved) state.reply.value = '';
        });
      if (kind === 'discussion-remove')
        void state.apply({ kind: 'remove_thread' }).then((saved) => {
          if (saved) state.resetEditor();
        });
    },
    { signal },
  );
  return () => {
    controller.abort();
    stopPickers();
  };
}
