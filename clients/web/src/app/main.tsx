import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import './style.css';

import { EmptyState } from '@kerfjs/ui/empty-state';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { ToolbarButton, ToolbarControlGroup } from '@kerfjs/ui/toolbar-control-group';
import { effect, mount } from 'kerfjs';
import { ChevronLeft, ChevronRight, Code, GitCompareArrows, Workflow } from 'lucide';

import { AnalysisContext, AnalysisControls, wireAnalysisControls } from '../components/analysis/analysis-controls.js';
import { createAnalysisState } from '../components/analysis/analysis-state.js';
import { createContextExpansion, resetContextOnChange } from '../components/diff/context-expansion.js';
import {
  createMediaDiffState,
  MediaDiff,
  MediaDiffToolbar,
  mediaModeLabel,
  wireMediaDiff,
} from '../components/diff/media-diff.js';
import { modeForImages } from '../components/diff/media-mode.js';
import { selectedDiff } from '../components/diff/selected-diff.js';
import {
  createTextDiffState,
  TextDiff,
  TextDiffToolbar,
  wireContextExpander,
  wireTextDiffToolbar,
} from '../components/diff/text-diff.js';
import {
  DiscussionInspector,
  LineCommentAction,
  LineDiscussion,
  wireDiscussion,
} from '../components/discussion/discussion.js';
import { createDiscussionState } from '../components/discussion/discussion-state.js';
import {
  createSavedReviewState,
  SavedReviewDialog,
  wireSavedReviewDialog,
} from '../components/discussion/saved-review-dialog.js';
import { ExportDialog, wireExportDialog } from '../components/handoff/export-dialog.js';
import { createExportState } from '../components/handoff/export-state.js';
import { createHandoffState } from '../components/handoff/handoff-state.js';
import { ShareMenu, ShareStatus, wireShareMenu } from '../components/handoff/share-menu.js';
import {
  createDefinitionLookup,
  includesDefinition,
  supportsDefinitions,
  wireDefinitionNavigation,
} from '../components/review/definition-navigation.js';
import { createReviewHistory, wireReviewHistory } from '../components/review/review-history.js';
import { ReviewNavigator, wireReviewNavigator } from '../components/review/review-navigator.js';
import { createReviewSourceState } from '../components/review/review-source.js';
import {
  createReviewWorkbenchState,
  ReviewWorkbench,
  wireReviewWorkbench,
} from '../components/review/review-workbench.js';
import {
  AnalysisSettingsAction,
  AnalysisSettingsDialog,
  wireAnalysisSettingsDialog,
} from '../components/settings/analysis-settings-dialog.js';
import { createAnalysisSettingsState } from '../components/settings/analysis-settings-state.js';
import { AppearanceMenu, wireAppearanceMenu } from '../components/settings/appearance-menu.js';
import { createAppearanceState } from '../components/settings/appearance-state.js';
import { StorageAction, StorageDialog, wireStorageDialog } from '../components/settings/storage-dialog.js';
import { createStorageState } from '../components/settings/storage-state.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

const workbench = createReviewWorkbenchState();
const source = createReviewSourceState();
const history = createReviewHistory();
const definitions = createDefinitionLookup();
const textDiff = createTextDiffState();
const diff = selectedDiff(source);
const diffContext = createContextExpansion(diff.result, () => {
  const active = source.activeSource.value;
  const index = source.selected.value;
  const file = index === undefined ? undefined : source.review.value?.files[index];
  return active === null || index === undefined || file === undefined
    ? null
    : { source: active, index, path: file.path };
});
void effect(() => {
  if (source.activeSource.value === null || source.selected.value === undefined || diff.result.value?.kind !== 'text') {
    definitions.clear();
  }
});
void resetContextOnChange(diffContext, diff.result);
const mediaDiff = createMediaDiffState();
const mediaId = 'glassbox-media-diff';
void effect(() => {
  const result = diff.result.value;
  if (result?.kind === 'media') {
    // HS2-Q3X4BX: keep the chosen mode and orientation across files when this pair supports it.
    const { mode, fellBack } = modeForImages(mediaDiff.preferred.peek(), result);
    mediaDiff.fallback.value = fellBack ? mediaModeLabel(mediaDiff.preferred.peek()) : null;
    mediaDiff.mode.value = mode;
  }
  if (result?.kind === 'loading') {
    mediaDiff.zoom.value = 100;
    mediaDiff.slice.value = 50;
    mediaDiff.drawing.value = false;
    mediaDiff.keyboardRegion.value = null;
  }
});
const discussion = createDiscussionState(source);
const savedReviews = createSavedReviewState();
const savedReviewId = 'glassbox-saved-reviews';
const changedPaths = () => new Set(source.review.value?.files.map(({ path }) => path));
const analysis = createAnalysisState(() => {
  void discussion.refreshCurrent();
});
const analysisId = 'glassbox-analysis';
void effect(() => {
  analysis.setSource(source.activeSource.value);
});

function selectedAnalysis() {
  const index = source.selected.value;
  const file = index === undefined ? undefined : source.review.value?.files[index];
  const content = diff.result.value;
  if (file === undefined || content?.kind !== 'text') return undefined;
  return { path: file.path, revision: content.revision };
}
const diffToolbarId = 'glassbox-text-diff';
const contextId = 'glassbox-diff-context';
const appearance = createAppearanceState();
const appearanceId = 'glassbox-appearance';
const handoff = createHandoffState();
const shareId = 'glassbox-share';
const exportId = 'glassbox-export';
const storageId = 'glassbox-storage';
const storage = createStorageState();
const analysisSettings = createAnalysisSettingsState();
const analysisSettingsId = 'glassbox-analysis-settings';
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
  const definition = history.active()?.definition;
  const snapshot =
    definition !== undefined &&
    (definition.index === null ||
      definition.index !== index ||
      result?.kind !== 'text' ||
      result.revision !== definition.diff_revision ||
      !includesDefinition(result.hunks, definition));
  const threads =
    result?.kind === 'text'
      ? discussion.threads.value.filter(
          ({ anchor }) => anchor.path === file?.path && anchor.revision === result.revision,
        )
      : [];
  const threadMap = new Map<string, typeof threads>();
  for (const thread of threads) {
    if (thread.anchor.target.kind !== 'line') continue;
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
  if (snapshot) {
    comparison = <TextDiff hunks={[]} path={definition.path} state={textDiff} definition={definition} snapshot />;
  } else if (file !== undefined) {
    switch (result?.kind) {
      case 'text': {
        const diagram = diff.showDiagram.value ? diff.diagram.value : null;
        const diagramControl =
          result.diagram === true ? (
            <ToolbarControlGroup label="Diagram View" content="icon">
              <ToolbarButton
                action="toggle-diagram"
                disabled={diff.diagramPending.value}
                pressed={diagram !== null}
                ariaLabel={diagram === null ? 'Render Diagram' : 'Show Diagram Source'}
                title={diagram === null ? 'Render Diagram' : 'Show Diagram Source'}
                icon={
                  diagram === null ? (
                    <LucideIcon icon={Workflow} name="workflow" />
                  ) : (
                    <LucideIcon icon={Code} name="code" />
                  )
                }
              />
            </ToolbarControlGroup>
          ) : null;
        if (diagram !== null) {
          comparison = <MediaDiff id={mediaId} images={diagram} state={mediaDiff} />;
          comparisonToolbar = (
            <>
              <MediaDiffToolbar id={mediaId} images={diagram} state={mediaDiff} allowRegions={false} />
              {diagramControl}
            </>
          );
          break;
        }
        comparison =
          result.hunks.length > 0 ? (
            <TextDiff
              hunks={result.hunks}
              path={file.path}
              state={textDiff}
              context={{ id: contextId, total: result.after_lines, expansion: diffContext.expansion.value }}
              definition={definition}
              symbols={source.activeSource.value?.kind === 'git' && supportsDefinitions(file.path)}
              lineControl={(side, line) => <LineCommentAction side={side} line={line} />}
              rowContent={(before, after) => (
                <LineDiscussion
                  threads={[...(threadMap.get(`before:${before}`) ?? []), ...(threadMap.get(`after:${after}`) ?? [])]}
                  active={discussion.threadId.value}
                  highlightRisk={analysis.modes.risk.enabled.value}
                />
              )}
            />
          ) : (
            <EmptyState title="No Text Changes" />
          );
        comparisonToolbar = (
          <>
            <TextDiffToolbar id={diffToolbarId} state={textDiff} />
            <AnalysisControls id={analysisId} state={analysis} />
            {diagramControl}
          </>
        );
        if (diff.diagramPending.value || diff.diagramError.value !== '') {
          comparison = (
            <>
              <p role="status">{diff.diagramPending.value ? 'Rendering diagram…' : diff.diagramError.value}</p>
              {comparison}
            </>
          );
        }
        break;
      }
      case 'media': {
        const regions = discussion.threads.value.flatMap(({ anchor, id }) =>
          anchor.target.kind === 'image_region' &&
          anchor.path === file.path &&
          anchor.revision === result[anchor.side]?.revision
            ? [{ side: anchor.side, target: anchor.target, id }]
            : [],
        );
        comparison = <MediaDiff id={mediaId} images={result} state={mediaDiff} regions={regions} />;
        comparisonToolbar = <MediaDiffToolbar id={mediaId} images={result} state={mediaDiff} />;
        break;
      }
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
  const selected = snapshot ? undefined : selectedAnalysis();
  return (
    <>
      <ReviewWorkbench
        id="glassbox-workbench"
        state={workbench}
        projectTitle={review?.identity ?? 'Changed Files'}
        comparisonTitle={(definition?.path ?? file?.path)?.split(/[\\/]/u).at(-1) ?? 'Review'}
        inspectorTitle={
          discussion.adding.value !== null
            ? 'New Comment'
            : discussion.activeThread()?.origin.kind === 'ai'
              ? 'AI Review Note'
              : discussion.activeThread()
                ? discussion.activeThread()?.anchor.target.kind === 'image_region'
                  ? 'Region Comment'
                  : 'Line Comment'
                : 'Inspector'
        }
        navigator={<ReviewNavigator id="glassbox-review-navigator" state={source} />}
        comparison={comparison}
        comparisonToolbar={comparisonToolbar}
        comparisonNavigation={
          review === null ? undefined : (
            <ToolbarControlGroup label="Review History" content="icon">
              <ToolbarButton
                action="review-history-back"
                disabled={!history.canMove(-1)}
                ariaLabel="Previous File Visit"
                title="Previous File Visit"
                icon={<LucideIcon icon={ChevronLeft} name="chevron-left" />}
              />
              <ToolbarButton
                action="review-history-forward"
                disabled={!history.canMove(1)}
                ariaLabel="Next File Visit"
                title="Next File Visit"
                icon={<LucideIcon icon={ChevronRight} name="chevron-right" />}
              />
            </ToolbarControlGroup>
          )
        }
        comparisonHeader={
          selected === undefined ? undefined : <AnalysisContext id={analysisId} state={analysis} selection={selected} />
        }
        footerStatus={
          definitions.status.value !== '' ? (
            <span role="status">{definitions.status.value}</span>
          ) : handoff.status.value === '' ? undefined : (
            <ShareStatus state={handoff} />
          )
        }
        footerSettings={
          <>
            <ShareMenu
              id={shareId}
              state={handoff}
              ready={source.activeSource.value !== null}
              exportReady
              savedReviews
            />
            <AppearanceMenu id={appearanceId} state={appearance} />
            <AnalysisSettingsAction id={analysisSettingsId} />
            <StorageAction id={storageId} />
          </>
        }
        inspector={
          snapshot ? (
            <></>
          ) : (
            <DiscussionInspector
              state={discussion}
              path={file?.path ?? discussion.staleFile.value?.path}
              revision={result?.kind === 'text' ? result.revision : undefined}
              mediaRevisions={
                result?.kind === 'media'
                  ? { before: result.before?.revision, after: result.after?.revision }
                  : undefined
              }
            />
          )
        }
      />
      <ExportDialog id={exportId} state={delivery} />
      <StorageDialog id={storageId} state={storage} />
      <SavedReviewDialog id={savedReviewId} state={savedReviews} changedPaths={changedPaths()} />
      <AnalysisSettingsDialog id={analysisSettingsId} state={analysisSettings} />
    </>
  );
});
void wireReviewWorkbench(root, 'glassbox-workbench', workbench);
void wireReviewNavigator(root, 'glassbox-review-navigator', source, {
  // A navigator that covers the work area closes once a file is chosen so its diff is visible (HS2-Q46BRQ).
  onFileSelect: () => {
    if (workbench.files.overlay.value) workbench.files.collapsed.value = true;
  },
});
const historyNavigation = wireReviewHistory(
  root,
  source,
  history,
  () => {
    const content = diff.result.value;
    return content !== null && content.kind !== 'loading';
  },
  discussion.saveEdit,
);
void wireDefinitionNavigation(
  root,
  definitions,
  () => {
    const active = source.activeSource.value;
    const index = source.selected.value;
    const content = diff.result.value;
    const file = index === undefined ? undefined : source.review.value?.files[index];
    if (active?.kind !== 'git' || index === undefined || file === undefined || content?.kind !== 'text')
      return undefined;
    return { source: active, index, path: file.path, revision: content.revision };
  },
  historyNavigation.reveal,
);
void wireTextDiffToolbar(root, diffToolbarId, textDiff);
void wireContextExpander(root, contextId, (gap, direction) => void diffContext.expand(gap, direction));
root.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('button[data-action="toggle-diagram"]') !== null) {
    event.stopImmediatePropagation();
    void diff.toggleDiagram();
  }
});
void wireMediaDiff(root, mediaId, mediaDiff, (side, target) => {
  const index = source.selected.value;
  const file = index === undefined ? undefined : source.review.value?.files[index];
  const content = diff.result.value;
  if (file === undefined || content?.kind !== 'media') return;
  const revision = content[side]?.revision;
  if (revision === undefined) return;
  void discussion.showAdd({ path: file.path, side, revision, target });
  workbench.inspector.collapsed.value = false;
});
void wireAnalysisControls(root, analysisId, analysis, selectedAnalysis);
void wireAppearanceMenu(root, appearanceId, appearance);
void wireAnalysisSettingsDialog(root, analysisSettingsId, analysisSettings);
void wireStorageDialog(root, storageId, storage);
const exportDialog = wireExportDialog(root, exportId, delivery);
const savedReviewDialog = wireSavedReviewDialog(
  root,
  savedReviewId,
  savedReviews,
  () => source.activeSource.value,
  changedPaths,
  () => void discussion.refreshCurrent(),
  async (active, path) => {
    if (!(await discussion.saveEdit()) || source.activeSource.value !== active) return false;
    source.selected.value = undefined;
    discussion.staleFile.value = { source: active, path };
    workbench.inspector.collapsed.value = false;
    return true;
  },
);
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
  savedReviewDialog.open,
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
  historyNavigation.reveal,
);
void appearance.load();
void source.openDifftool();
