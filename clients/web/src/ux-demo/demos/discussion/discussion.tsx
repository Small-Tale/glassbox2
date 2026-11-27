import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { Text } from '@kerfjs/ui/text';
import { signal } from 'kerfjs';

import { DiscussionInspector, LineDiscussion, wireDiscussion } from '../../../components/discussion/discussion.js';
import {
  type Anchor,
  type AttachmentApi,
  createDiscussionState,
  type SourceLinkApi,
  type Thread,
} from '../../../components/discussion/discussion-state.js';
import { createReviewSourceState, type ReviewFiles } from '../../../components/review/review-source.js';

const anchor: Anchor = {
  path: 'src/bundle.ts',
  side: 'after',
  revision: 'example',
  target: { kind: 'line', start: 23, end: 23 },
};
const files: ReviewFiles = {
  identity: 'Fieldnotes',
  branch: 'feature/review-bundles',
  comparison: 'Working tree',
  files: [{ path: anchor.path, previous_path: null, status: 'modified' }],
};
// HS2-3G613V: fixture bytes stand in for the host's verified preview and open endpoints.
const samplePng = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAGAAAAA4CAIAAACNJ2r1AAAAfklEQVR42u3ZQQ0AIAwDwElECZqQwxsHOJmJkSzkkgro7tnFmKsk+9ySdOsTgAABAgQIECBAgAABAgQIUDugXw+r6gMIECBAgAABAgQIECBAgAD1AzJ32IMAAQIECBAgQIAAAQIECJDfvD0IECBAgAABAgQIECBAgAABetonAb5KaNnzVwUHAAAAAElFTkSuQmCC',
  ),
  (character) => character.charCodeAt(0),
);
const samplePdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const attachmentApi: AttachmentApi = {
  preview: (_selection, _thread, attachment) =>
    Promise.resolve(
      attachment === 11
        ? new Blob([samplePdf], { type: 'application/pdf' })
        : new Blob([samplePng], { type: 'image/png' }),
    ),
  open: () => Promise.resolve(200),
};
// GB2-X1EATS: fixture answers for the host's source-link endpoint, so the demo follows links without a host. The
// first link is a location in the open review; the second cites an earlier commit and opens a new review.
const followLink: SourceLinkApi = (_selection, _thread, index) =>
  Promise.resolve(
    index === 1
      ? { kind: 'commit', directory: '/demo/fieldnotes', commit: 'abcdef1234', path: 'src/bundle.ts', line: 8 }
      : {
          path: 'src/bundle-paths.ts',
          side: 'after',
          revision: 'demo',
          diff_revision: null,
          index: null,
          line: 12,
          text: 'export const unique = true;',
        },
  );
/** What the last followed link did, as a person would see it (the application opens a tab or reveals a line). */
const linkResult = signal('No link followed yet.');
const source = createReviewSourceState(files, () => Promise.resolve(files));
const initial: Thread[] = [
  {
    id: 1,
    revision: 1,
    anchor,
    origin: { kind: 'reviewer', category: 'style' },
    opening: {
      author: 'Reviewer',
      markdown: 'Use a name that explains what is being written.',
      attachments: [
        { id: 10, filename: 'rename-sketch.png', preview: 'image', openable: true },
        { id: 11, filename: 'naming-notes.pdf', preview: 'pdf', openable: true },
        { id: 12, filename: 'build-output.zip', openable: false },
      ],
    },
    replies: [{ id: 2, message: { author: 'You', markdown: 'I’ll use temporaryBundlePath.', attachments: [] } }],
  },
  {
    id: 3,
    revision: 1,
    anchor,
    origin: {
      kind: 'ai',
      tags: ['Concurrency'],
      risk: 'medium',
      related_locations: [
        { path: 'src/bundle-paths.ts', line: 12, revision: 'demo' },
        { path: 'src/bundle.ts', line: 8, revision: 'demo', commit: 'abcdef1234' },
      ],
    },
    opening: {
      author: 'AI note',
      markdown: 'Simultaneous saves can resolve to the same filename. See [the helper](0) and [the earlier fix](1).',
      attachments: [],
    },
    replies: [
      { id: 4, message: { author: 'Reviewer', markdown: 'A unique path would avoid the collision.', attachments: [] } },
    ],
  },
];
// Moving a thread rewrites its anchor in memory, the way the host would after validating the destination.
let saved = initial;
const state = createDiscussionState(
  source,
  (_selection, operation) => {
    if (operation?.kind === 'move') {
      saved = saved.map((item) =>
        item.id === operation.id ? { ...item, revision: item.revision + 1, anchor: operation.anchor as Anchor } : item,
      );
    }
    return Promise.resolve(saved);
  },
  undefined,
  attachmentApi,
  followLink,
);
state.threads.value = initial;
void state.showThread(1);

export function DiscussionDemo() {
  return (
    <CatalogExampleStack label="Review Discussion" rootAttributes={{ 'data-demo': 'review-discussion' }}>
      <CatalogExample label="Independent Threads on One Line">
        <LineDiscussion threads={state.threads.value} active={state.threadId.value} />
      </CatalogExample>
      <CatalogExample label="Contextual Inspector" viewport={{ width: 'sidebar' }}>
        <DiscussionInspector state={state} path={anchor.path} revision={anchor.revision} />
      </CatalogExample>
      <CatalogExample label="Source Link Result">
        <Text role="status" rootAttributes={{ 'data-demo-link-result': '' }}>
          {linkResult.value}
        </Text>
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireDiscussionDemo(root: HTMLElement) {
  // Saving needs an open comparison and a selected file, so the demo opens its sample the way a person would.
  void source.open({ kind: 'paths', before: 'before', after: 'after' }).then(async () => {
    source.selected.value = 0;
    await state.refreshCurrent();
    await state.showThread(1);
  });
  return wireDiscussion(
    root,
    state,
    (side, line) => ({ ...anchor, side, target: { kind: 'line', start: line, end: line } }),
    () => undefined,
    (destination) => {
      linkResult.value = `Revealed ${destination.path} line ${destination.line} in this review.`;
      return Promise.resolve();
    },
    undefined,
    (target) => {
      linkResult.value = `Opened commit ${target.commit.slice(0, 7)} at ${target.path} line ${target.line} in a new review.`;
      return true;
    },
  );
}
