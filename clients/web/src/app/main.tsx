import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import './style.css';

import { EmptyState } from '@kerfjs/ui/empty-state';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { effect, mount } from 'kerfjs';
import { GitCompareArrows } from 'lucide';

import { selectedDiff } from '../components/diff/selected-diff.js';
import { createTextDiffState, TextDiff, TextDiffToolbar, wireTextDiffToolbar } from '../components/diff/text-diff.js';
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
const diffToolbarId = 'glassbox-text-diff';
const appearance = createAppearanceState();
const appearanceId = 'glassbox-appearance';
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
            <TextDiff hunks={result.hunks} path={file.path} state={textDiff} />
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
    <ReviewWorkbench
      id="glassbox-workbench"
      state={workbench}
      projectTitle={review?.identity ?? 'Changed Files'}
      comparisonTitle={file?.path.split('/').at(-1) ?? 'Review'}
      inspectorTitle="Inspector"
      navigator={<ReviewNavigator id="glassbox-review-navigator" state={source} />}
      comparison={comparison}
      comparisonToolbar={comparisonToolbar}
      footerSettings={<AppearanceMenu id={appearanceId} state={appearance} />}
      inspector={<EmptyState title="No Discussion Selected" />}
    />
  );
});
void wireReviewWorkbench(root, 'glassbox-workbench', workbench);
void wireReviewNavigator(root, 'glassbox-review-navigator', source);
void wireTextDiffToolbar(root, diffToolbarId, textDiff);
void wireAppearanceMenu(root, appearanceId, appearance);
void appearance.load();
void source.openDifftool();
