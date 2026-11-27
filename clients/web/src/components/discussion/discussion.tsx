import './discussion.css';
import '@kerfjs/ui/select/register';

import { Badge } from '@kerfjs/ui/badge';
import { Button } from '@kerfjs/ui/button';
import { ContentItem } from '@kerfjs/ui/content-item';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { FilePickerTrigger } from '@kerfjs/ui/file-picker';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { Row } from '@kerfjs/ui/row';
import { Select } from '@kerfjs/ui/select';
import { StateBanner } from '@kerfjs/ui/state-banner';
import { Text } from '@kerfjs/ui/text';
import { TextField } from '@kerfjs/ui/text-field';
import { wireContentItems } from '@kerfjs/ui/wire-content-items';
import { wireFilePickers } from '@kerfjs/ui/wire-file-pickers';
import { ExternalLink, MessageSquarePlus } from 'lucide';

import type { Definition } from '../review/definition-navigation.js';
import type { CommitTarget } from '../review/review-link.js';
import {
  type Anchor,
  type Attachment,
  categories,
  type DiscussionState,
  isDiagramAttachment,
  type Side,
  sourceLinkParts,
  type Thread,
} from './discussion-state.js';
import { RelocationOffer } from './relocation-offer.js';

function citedCommitTitle(commit: string | undefined) {
  return commit === undefined ? undefined : `Opens commit ${commit.slice(0, 10)} in a new review`;
}

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
        <ContentItem
          interactive
          selectionMode="toggle"
          action={`discussion-show:${thread.id}`}
          selected={active === thread.id}
          frame="framed"
          appearance={
            highlightRisk && thread.origin.kind === 'ai' && thread.origin.risk !== null ? 'warning' : 'surface'
          }
        >
          <Row wrap vAlign="middle">
            <Text variant="span" weight="strong">
              {thread.opening.author}
            </Text>
            <ThreadLabels thread={thread} />
            {thread.replies.length === 0 ? null : (
              <Text variant="span" tone="quiet">
                {`${thread.replies.length} ${thread.replies.length === 1 ? 'reply' : 'replies'}`}
              </Text>
            )}
          </Row>
          <Text wrap="anywhere" flush>
            {thread.origin.kind === 'ai'
              ? sourceLinkParts(thread.opening.markdown, thread.origin.related_locations ?? [])
                  .map((part) => (typeof part === 'string' ? part : part.label))
                  .join('')
              : thread.opening.markdown}
          </Text>
          {thread.replies[0] === undefined ? null : (
            <Text wrap="anywhere" tone="quiet" flush>
              {thread.replies[0].message.markdown}
            </Text>
          )}
        </ContentItem>
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
  function attachment({ id, filename, preview, openable }: Attachment) {
    if (!isDiagramAttachment(filename)) {
      // HS2-3G613V: only an attachment the host verified is previewed or offered to the operating system.
      const loaded = state.attachmentPreviews.value[id];
      const expanded = state.expandedAttachment.value === id;
      const pdfSupported =
        typeof navigator === 'undefined' || (navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;
      const stateLine = (message: string, tone?: 'quiet' | 'danger') => (
        <Text role="status" tone={tone}>
          {message}
        </Text>
      );
      return (
        <div class="discussion-inspector__attachment" data-key={`discussion-attachment-${id}`}>
          <Text wrap="anywhere">{filename}</Text>
          {preview === 'image' ? (
            loaded === undefined || loaded.status === 'loading' ? (
              stateLine('Loading preview…', 'quiet')
            ) : loaded.status === 'failed' ? (
              stateLine(loaded.message, 'danger')
            ) : (
              <img
                class="discussion-inspector__thumbnail"
                data-expanded={String(expanded)}
                src={loaded.url}
                alt={filename}
              />
            )
          ) : null}
          {preview === 'pdf' && expanded ? (
            loaded === undefined || loaded.status === 'loading' ? (
              stateLine('Loading preview…', 'quiet')
            ) : loaded.status === 'failed' ? (
              stateLine(loaded.message, 'danger')
            ) : pdfSupported ? (
              <object
                class="discussion-inspector__document"
                data={loaded.url}
                type="application/pdf"
                aria-label={filename}
              />
            ) : (
              stateLine('This window cannot show PDF previews. Use Open Externally.', 'quiet')
            )
          ) : null}
          {preview === undefined ? <Text tone="quiet">Preview unavailable for this file type.</Text> : null}
          {preview === undefined && openable !== true ? null : (
            <Row wrap controlInsets="trbl">
              {preview === undefined ? null : (
                <Button
                  action={`discussion-attachment-toggle:${id}`}
                  emphasis="plain"
                  tone="brand"
                  ariaLabel={`${expanded ? 'Shrink' : preview === 'pdf' ? 'Preview' : 'Enlarge'} ${filename}`}
                >
                  {expanded ? 'Shrink Preview' : preview === 'pdf' ? 'Preview PDF' : 'Enlarge Preview'}
                </Button>
              )}
              {openable === true ? (
                <Button
                  action={`discussion-attachment-open:${id}`}
                  emphasis="plain"
                  tone="brand"
                  ariaLabel={`Open ${filename} Externally`}
                  icon={<LucideIcon icon={ExternalLink} name="external-link" />}
                >
                  Open Externally
                </Button>
              ) : null}
            </Row>
          )}
        </div>
      );
    }
    return (
      <div class="discussion-inspector__attachment">
        <Button action={`discussion-artifact:${id}`} emphasis="plain" tone="brand">
          {artifact?.id === id ? `Close ${filename}` : `Preview ${filename}`}
        </Button>
        {artifact?.id !== id ? null : artifact.preview === undefined ? (
          <Text role="status">{artifact.message ?? 'Loading diagram…'}</Text>
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
          <EmptyState
            title="No Discussion Selected"
            detail="Select a comment in the diff to read it, or use the comment action beside a line to start one."
          />
          {wholeImage.length === 0 ? null : (
            <Row wrap controlInsets="trbl">
              {wholeImage.map((side) => (
                <Button action={`discussion-whole-image:${side}`} emphasis="plain" tone="brand">
                  {`Comment on Whole ${side === 'before' ? 'Before' : 'After'} Image`}
                </Button>
              ))}
            </Row>
          )}
        </>
      );
    }
    return (
      <section class="discussion-inspector" aria-label="Stale Discussions">
        <Text>These comments refer to an earlier version of this file.</Text>
        <LineDiscussion threads={stale} active={state.threadId.value} />
      </section>
    );
  }
  const isStale = thread !== undefined && thread.anchor.revision !== currentRevision(thread.anchor);
  const locations = thread?.origin.kind === 'ai' ? (thread.origin.related_locations ?? []) : [];
  return (
    <section class="discussion-inspector" aria-label="Discussion">
      <Row wrap vAlign="middle">
        {thread === undefined ? null : <ThreadLabels thread={thread} />}
        <Text variant="span" wrap="anywhere">
          {`${anchor.path} · ${anchor.side === 'before' ? 'Before' : 'After'} ${
            anchor.target.kind === 'line' ? `line ${anchor.target.start}` : 'image region'
          }`}
        </Text>
      </Row>
      {isStale ? <Text role="status">This comment refers to an earlier version of the file.</Text> : null}
      {isStale && thread.anchor.target.kind === 'line' ? <RelocationOffer state={state} /> : null}
      {state.error.value === '' ? null : <StateBanner tone="danger" urgency="alert" title={state.error.value} />}
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
        <Text wrap="anywhere">
          {thread?.origin.kind === 'ai'
            ? sourceLinkParts(thread.opening.markdown, locations).map((part) =>
                typeof part === 'string' ? (
                  part
                ) : (
                  <Button
                    action={`discussion-source-link:${part.index}`}
                    emphasis="link"
                    tone="brand"
                    title={citedCommitTitle(locations[part.index]?.commit)}
                    disabled={isStale}
                  >
                    {part.label}
                  </Button>
                ),
              )
            : thread?.opening.markdown}
        </Text>
      )}
      {isDraft ? (
        <Row wrap hAlign="right" controlInsets="trbl">
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
        </Row>
      ) : (
        <>
          {thread?.opening.attachments.map(attachment)}
          {state.attachmentStatus.value === '' ? null : <Text role="status">{state.attachmentStatus.value}</Text>}
          <FilePickerTrigger label="Attach to Thread" pickerId="discussion-attachment" disabled={state.pending.value} />
          {editable ? (
            <Row wrap hAlign="full" vAlign="middle" controlInsets="trbl">
              <Text variant="span" role="status">
                {state.pending.value ? 'Saving…' : 'Saves automatically'}
              </Text>
              <Button action="discussion-remove" tone="danger" emphasis="plain" disabled={state.pending.value}>
                Remove
              </Button>
            </Row>
          ) : null}
          {thread?.anchor.target.kind !== 'image_region' ? null : state.regionEdit.value === null ? (
            <Row wrap controlInsets="trbl" rootAttributes={{ 'data-key': 'discussion-region-open' }}>
              <Button action="discussion-region-edit" emphasis="plain" tone="brand" disabled={state.pending.value}>
                Edit Region
              </Button>
            </Row>
          ) : (
            <div class="discussion-inspector__form" data-key="discussion-region-edit">
              <Text role="status">
                Drag on the image, or use the arrow keys (Shift resizes), then press Enter to save.
              </Text>
              <Row wrap controlInsets="trbl">
                <Button action="discussion-region-cancel" emphasis="plain">
                  Cancel
                </Button>
              </Row>
            </div>
          )}
          {thread?.anchor.target.kind !== 'line' ? null : state.moving.value === null ? (
            <Row wrap controlInsets="trbl" rootAttributes={{ 'data-key': 'discussion-move-open' }}>
              <Button action="discussion-move" emphasis="plain" tone="brand" disabled={state.pending.value}>
                Move Comment
              </Button>
            </Row>
          ) : (
            // Keyed so the browser's morph never reuses the focused Move to Line input for the Reply fields below it.
            <div class="discussion-inspector__form" data-key="discussion-move-form">
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
              <Row wrap hAlign="right" controlInsets="trbl">
                <Button action="discussion-move-cancel" emphasis="plain">
                  Cancel
                </Button>
                <Button action="discussion-move-submit" tone="brand" disabled={state.pending.value}>
                  Move
                </Button>
              </Row>
            </div>
          )}
          {thread?.replies.map(({ message }) => (
            <ContentItem frame="framed">
              <Text weight="strong" flush>
                {message.author}
              </Text>
              <Text wrap="anywhere" flush>
                {message.markdown}
              </Text>
              {message.attachments.map(attachment)}
            </ContentItem>
          ))}
          <TextField name="discussion-author" label="Reply Author" value={state.author.value} />
          <TextField name="discussion-reply" label="Reply" multiline rows={2} value={state.reply.value} />
          <Row wrap hAlign="right" controlInsets="trbl">
            <Button
              action="discussion-reply"
              tone="brand"
              disabled={state.pending.value || state.reply.value.trim() === '' || state.author.value.trim() === ''}
            >
              Post Reply
            </Button>
          </Row>
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
  /** Opens a cited commit's review in a new tab; answers false when the browser refused (HS2-B5K6GM). */
  openReview?: (target: CommitTarget) => boolean,
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
  const stopContentItems = wireContentItems(root);
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
      const action = event.target.closest<HTMLElement>('[data-action]')?.dataset.action;
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
      if (kind === 'discussion-attachment-toggle') state.toggleAttachment(Number(first));
      if (kind === 'discussion-attachment-open') void state.openAttachment(Number(first));
      if (kind === 'discussion-source-link' && reveal !== undefined)
        void state.openSourceLink(Number(first), reveal, openReview);
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
    stopContentItems();
    stopPickers();
  };
}
