import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { ReviewNavigator, wireReviewNavigator } from '../../../components/review/review-navigator.js';
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

export function ReviewNavigatorDemo() {
  return (
    <CatalogExampleStack label="Review Navigator" rootAttributes={{ 'data-demo': 'review-navigator' }}>
      <CatalogExample label="Git Changed Files" viewport={{ width: 'sidebar' }}>
        <ReviewNavigator id={id} state={state} />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireReviewNavigatorDemo(root: HTMLElement) {
  return wireReviewNavigator(root, id, state);
}
