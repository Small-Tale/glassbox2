import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { DiscussionInspector, LineDiscussion, wireDiscussion } from '../../../components/discussion/discussion.js';
import { type Anchor, createDiscussionState, type Thread } from '../../../components/discussion/discussion-state.js';
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
const source = createReviewSourceState(files, () => Promise.resolve(files));
const initial: Thread[] = [
  {
    id: 1,
    revision: 1,
    anchor,
    origin: { kind: 'reviewer', category: 'style' },
    opening: { author: 'Reviewer', markdown: 'Use a name that explains what is being written.', attachments: [] },
    replies: [{ id: 2, message: { author: 'You', markdown: 'I’ll use temporaryBundlePath.', attachments: [] } }],
  },
  {
    id: 3,
    revision: 1,
    anchor,
    origin: { kind: 'ai', tags: ['Concurrency'], risk: 'medium' },
    opening: { author: 'AI note', markdown: 'Simultaneous saves can resolve to the same filename.', attachments: [] },
    replies: [
      { id: 4, message: { author: 'Reviewer', markdown: 'A unique path would avoid the collision.', attachments: [] } },
    ],
  },
];
// Moving a thread rewrites its anchor in memory, the way the host would after validating the destination.
let saved = initial;
const state = createDiscussionState(source, (_selection, operation) => {
  if (operation?.kind === 'move') {
    saved = saved.map((item) =>
      item.id === operation.id ? { ...item, revision: item.revision + 1, anchor: operation.anchor as Anchor } : item,
    );
  }
  return Promise.resolve(saved);
});
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
  );
}
