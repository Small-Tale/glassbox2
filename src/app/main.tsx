import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import './style.css';

import { EmptyState } from '@kerfjs/ui/empty-state';
import { LucideIcon } from '@kerfjs/ui/lucide-icon';
import { mount } from 'kerfjs';
import { GitCompareArrows } from 'lucide';

import { ReviewNavigator, wireReviewNavigator } from '../components/review/review-navigator.js';
import { createReviewSourceState } from '../components/review/review-source.js';
import {
  createReviewWorkbenchState,
  ReviewWorkbench,
  wireReviewWorkbench,
} from '../components/review/review-workbench.js';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

const workbench = createReviewWorkbenchState();
const source = createReviewSourceState();
mount(root, () => {
  const review = source.review.value;
  const index = source.selected.value;
  const file = index === undefined ? undefined : review?.files[index];
  return (
    <ReviewWorkbench
      id="glassbox-workbench"
      state={workbench}
      projectTitle={review?.identity ?? 'Changed Files'}
      comparisonTitle={file?.path.split('/').at(-1) ?? 'Review'}
      inspectorTitle="Inspector"
      navigator={<ReviewNavigator id="glassbox-review-navigator" state={source} />}
      comparison={
        <EmptyState
          title={file?.path ?? (review === null ? 'No Review Open' : 'No File Selected')}
          icon={<LucideIcon icon={GitCompareArrows} name="git-compare-arrows" />}
        />
      }
      inspector={<EmptyState title="No Discussion Selected" />}
    />
  );
});
void wireReviewWorkbench(root, 'glassbox-workbench', workbench);
void wireReviewNavigator(root, 'glassbox-review-navigator', source);
void source.openDifftool();
