import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { signal } from 'kerfjs';

import { createAnalysisState } from '../../../components/analysis/analysis-state.js';
import type { FileOrder } from '../../../components/review/file-order.js';
import { ReviewNavigator, wireReviewNavigator } from '../../../components/review/review-navigator.js';
import { createReviewProgress, watchReviewProgress } from '../../../components/review/review-progress.js';
import { createReviewSourceState, type ReviewFiles } from '../../../components/review/review-source.js';

const sample: ReviewFiles = {
  identity: 'Fieldnotes',
  branch: 'feature/review-bundles',
  comparison: 'Working tree',
  files: [
    { path: 'src/bundle.ts', previous_path: null, status: 'modified' },
    { path: 'src/settings.ts', previous_path: null, status: 'modified' },
    { path: 'tests/bundle.test.ts', previous_path: null, status: 'added' },
    { path: 'README.md', previous_path: null, status: 'modified' },
  ],
};
const id = 'demo-review-navigator';
const state = createReviewSourceState(sample, () => Promise.resolve(sample));
const sourceId = 'demo-review-source-form';
const sourceState = createReviewSourceState(undefined, () => Promise.resolve(sample));
const progressId = 'demo-review-progress';
const progressState = createReviewSourceState(sample, () => Promise.resolve(sample));
progressState.selected.value = 1;
// Fixture marks stand in for the host: one file reviewed, one changed since it was reviewed.
const progress = createReviewProgress(progressState, signal({ kind: 'text', revision: 'fixture' }), {
  list: () =>
    Promise.resolve([
      { path: 'src/bundle.ts', state: 'reviewed' },
      { path: 'README.md', state: 'changed' },
    ]),
  mark: () => Promise.resolve(),
});
const orderId = 'demo-review-order';
const orderState = createReviewSourceState(sample, () => Promise.resolve(sample));
const order = signal<FileOrder>('risk');
// Fixture analysis: three files scored, one left out, so the Risk order shows its sections.
const risk = (path: string, aggregate: number, rationale: string) => ({
  path,
  revision: 'fixture',
  analysis: { kind: 'risk' as const, rationale, aggregate },
});
const analysis = createAnalysisState(() => undefined, {
  start: () =>
    Promise.resolve({
      id: 1,
      status: 'complete' as const,
      result: {
        files: [
          risk('src/settings.ts', 0.82, 'Writes settings without a lock.'),
          risk('src/bundle.ts', 0.45, 'New temporary file handling.'),
          risk('tests/bundle.test.ts', 0.1, 'Adds coverage only.'),
        ],
        narrative: [
          { path: 'src/bundle.ts', revision: 'fixture', reason: 'Start with the writer.' },
          { path: 'src/settings.ts', revision: 'fixture', reason: 'Then the settings it reads.' },
        ],
        skipped: [],
      },
    }),
  status: () => Promise.resolve({ id: 1, status: 'unavailable' as const, message: 'Unavailable.' }),
  cancel: () => Promise.resolve({ id: 1, status: 'cancelled' as const }),
  wait: () => Promise.resolve(),
});
const emptyId = 'demo-review-empty';
const empty = { ...sample, files: [] };
const emptyState = createReviewSourceState(empty, () => Promise.resolve(empty));

export function ReviewNavigatorDemo() {
  return (
    <CatalogExampleStack label="Review Navigator" rootAttributes={{ 'data-demo': 'review-navigator' }}>
      <CatalogExample label="Git Changed Files" viewport={{ width: 'sidebar' }}>
        <ReviewNavigator id={id} state={state} />
      </CatalogExample>
      <CatalogExample label="Review Progress" viewport={{ width: 'sidebar' }}>
        <ReviewNavigator id={progressId} state={progressState} progress={progress} />
      </CatalogExample>
      <CatalogExample label="Risk and Narrative Order" viewport={{ width: 'sidebar' }}>
        <ReviewNavigator id={orderId} state={orderState} ordering={{ order, analysis }} />
      </CatalogExample>
      <CatalogExample label="Open a Comparison" viewport={{ width: 'sidebar' }}>
        <ReviewNavigator id={sourceId} state={sourceState} />
      </CatalogExample>
      <CatalogExample label="Unchanged Comparison" viewport={{ width: 'sidebar' }}>
        <ReviewNavigator id={emptyId} state={emptyState} />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireReviewNavigatorDemo(root: HTMLElement) {
  const stopFiles = wireReviewNavigator(root, id, state);
  const stopSource = wireReviewNavigator(root, sourceId, sourceState, { wireKeyboard: false });
  const stopEmpty = wireReviewNavigator(root, emptyId, emptyState, { wireKeyboard: false });
  const stopProgress = wireReviewNavigator(root, progressId, progressState, {
    wireKeyboard: false,
    onToggleReviewed: () => void progress.toggleSelected(),
  });
  // Opening the sample as a source gives the progress something to load marks for.
  void progressState.open({ kind: 'paths', before: 'before', after: 'after' }).then(() => {
    progressState.selected.value = 1;
  });
  const stopOrder = wireReviewNavigator(root, orderId, orderState, {
    wireKeyboard: false,
    onOrder: (next) => {
      order.value = next;
      if (next !== 'path' && analysis.modes[next].status.value === null) void analysis.toggle(next);
    },
  });
  void orderState.open({ kind: 'paths', before: 'before', after: 'after' }).then(() => {
    analysis.setSource({ kind: 'paths', before: 'before', after: 'after' });
    void analysis.toggle('risk');
  });
  const stopWatch = watchReviewProgress(progress);
  return () => {
    stopWatch();
    stopOrder();
    stopProgress();
    stopFiles();
    stopSource();
    stopEmpty();
  };
}
