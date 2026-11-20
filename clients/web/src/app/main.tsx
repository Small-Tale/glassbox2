import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import './style.css';

import { EmptyState } from '@kerfjs/ui/empty-state';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { effect, mount } from 'kerfjs';
import { GitCompareArrows } from 'lucide';

import { selectedDiff } from '../components/diff/selected-diff.js';
import { createTextDiffState, TextDiff, TextDiffToolbar, wireTextDiffToolbar } from '../components/diff/text-diff.js';
import {
  DiscussionInspector,
  LineCommentAction,
  LineDiscussion,
  wireDiscussion,
} from '../components/discussion/discussion.js';
import { createDiscussionState } from '../components/discussion/discussion-state.js';
import { ExportDialog, wireExportDialog } from '../components/handoff/export-dialog.js';
import { createExportState } from '../components/handoff/export-state.js';
import { createHandoffState } from '../components/handoff/handoff-state.js';
import { ShareMenu, ShareStatus, wireShareMenu } from '../components/handoff/share-menu.js';
import { ReviewNavigator, wireReviewNavigator } from '../components/review/review-navigator.js';
import { createReviewSourceState } from '../components/review/review-source.js';
import {
  createReviewWorkbenchState,
  ReviewWorkbench,
  wireReviewWorkbench,
} from '../components/review/review-workbench.js';
import { AppearanceMenu, wireAppearanceMenu } from '../components/settings/appearance-menu.js';
import { createAppearanceState } from '../components/settings/appearance-state.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

const workbench = createReviewWorkbenchState();
const source = createReviewSourceState();
const textDiff = createTextDiffState();
const diff = selectedDiff(source);
const discussion = createDiscussionState(source);
const diffToolbarId = 'glassbox-text-diff';
const appearance = createAppearanceState();
const appearanceId = 'glassbox-appearance';
const handoff = createHandoffState();
const shareId = 'glassbox-share';
const exportId = 'glassbox-export';
const delivery = createExportState();
void effect(() => {
  const preference = appearance.appearance.value;
  if (preference === 'system') delete document.documentElement.dataset.kuiScheme;
  else document.documentElement.dataset.kuiScheme = preference;
});
mount(root, () => {
  const review = source.review.value;
  const index = source.selected.value;
  const file = index === undefined ? undefined : review?.files[index];
  const result = diff.result.value;
  const threads =
    result?.kind === 'text'
      ? discussion.threads.value.filter(
          ({ anchor }) => anchor.path === file?.path && anchor.revision === result.revision,
        )
      : [];
  const threadMap = new Map<string, typeof threads>();
  for (const thread of threads) {
    const key = `${thread.anchor.side}:${thread.anchor.target.start}`;
    const existing = threadMap.get(key);
    if (existing === undefined) threadMap.set(key, [thread]);
    else existing.push(thread);
  }
  let comparison = (
    <EmptyState
      title={review === null ? 'No Review Open' : 'No File Selected'}
      icon={<LucideIcon icon={GitCompareArrows} name="git-compare-arrows" />}
    />
  );
  let comparisonToolbar;
  if (file !== undefined) {
    switch (result?.kind) {
      case 'text':
        comparison =
          result.hunks.length > 0 ? (
            <TextDiff
              hunks={result.hunks}
              path={file.path}
              state={textDiff}
              lineControl={(side, line) => <LineCommentAction side={side} line={line} />}
              rowContent={(before, after) => (
                <LineDiscussion
                  threads={[...(threadMap.get(`before:${before}`) ?? []), ...(threadMap.get(`after:${after}`) ?? [])]}
                  active={discussion.threadId.value}
                />
              )}
            />
          ) : (
            <EmptyState title="No Text Changes" />
          );
        comparisonToolbar = <TextDiffToolbar id={diffToolbarId} state={textDiff} />;
        break;
      case 'media':
        comparison = <EmptyState title="Media Comparison" />;
        break;
      case 'unavailable_lfs':
        comparison = (
          <EmptyState
            title="Git LFS Media Unavailable"
            detail="The original object is unavailable in the local cache."
          />
        );
        break;
      case 'binary':
        comparison = <EmptyState title="Binary File Changed" />;
        break;
      case 'error':
        comparison = <EmptyState title="Could Not Open File" detail={result.message} />;
        break;
      case 'loading':
      case undefined:
        comparison = <EmptyState title="Loading Comparison" />;
        break;
    }
  }
  return (
    <>
      <ReviewWorkbench
        id="glassbox-workbench"
        state={workbench}
        projectTitle={review?.identity ?? 'Changed Files'}
        comparisonTitle={file?.path.split('/').at(-1) ?? 'Review'}
        inspectorTitle={
          discussion.adding.value !== null
            ? 'New Comment'
            : discussion.activeThread()?.origin.kind === 'ai'
              ? 'AI Review Note'
              : discussion.activeThread()
                ? 'Line Comment'
                : 'Inspector'
        }
        navigator={<ReviewNavigator id="glassbox-review-navigator" state={source} />}
        comparison={comparison}
        comparisonToolbar={comparisonToolbar}
        footerStatus={handoff.status.value === '' ? undefined : <ShareStatus state={handoff} />}
        footerSettings={
          <>
            <ShareMenu id={shareId} state={handoff} ready={source.activeSource.value !== null} exportReady />
            <AppearanceMenu id={appearanceId} state={appearance} />
          </>
        }
        inspector={
          <DiscussionInspector
            state={discussion}
            path={file?.path}
            revision={result?.kind === 'text' ? result.revision : undefined}
          />
        }
      />
      <ExportDialog id={exportId} state={delivery} />
    </>
  );
});
void wireReviewWorkbench(root, 'glassbox-workbench', workbench);
void wireReviewNavigator(root, 'glassbox-review-navigator', source);
void wireTextDiffToolbar(root, diffToolbarId, textDiff);
void wireAppearanceMenu(root, appearanceId, appearance);
const exportDialog = wireExportDialog(root, exportId, delivery);
void wireShareMenu(
  root,
  shareId,
  handoff,
  () => source.activeSource.value,
  discussion.saveEdit,
  () => {
    const active = source.activeSource.value;
    if (active !== null) exportDialog.open(active, discussion.saveEdit);
  },
);
void wireDiscussion(
  root,
  discussion,
  (side, line) => {
    const index = source.selected.value;
    const file = index === undefined ? undefined : source.review.value?.files[index];
    const content = diff.result.value;
    if (file === undefined || content?.kind !== 'text') return undefined;
    return { side, path: file.path, revision: content.revision, target: { kind: 'line', start: line, end: line } };
  },
  () => {
    workbench.inspector.collapsed.value = false;
  },
);
void appearance.load();
void source.openDifftool();
