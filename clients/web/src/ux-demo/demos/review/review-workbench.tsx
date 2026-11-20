import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { EmptyState } from '@kerfjs/ui/empty-state';

import {
  createReviewWorkbenchState,
  ReviewWorkbench,
  wireReviewWorkbench,
} from '../../../components/review/review-workbench.js';
import { SourceContext } from '../../../components/review/source-context.js';

const id = 'catalog-review-workbench';
const state = createReviewWorkbenchState();

export function ReviewWorkbenchDemo() {
  return (
    <CatalogExampleStack width="full" rootAttributes={{ 'data-demo': 'review-workbench' }}>
      <CatalogExample label="Responsive Workbench" viewport={{ width: 'full', height: 'app', frame: 'solid' }}>
        <ReviewWorkbench
          id={id}
          state={state}
          projectTitle="Fieldnotes"
          comparisonTitle="Review"
          inspectorTitle="Inspector"
          navigator={<SourceContext identity="feature/review-bundles" comparison="Working tree" />}
          comparison={<EmptyState title="No File Selected" />}
          inspector={<EmptyState title="No Discussion Selected" />}
        />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireReviewWorkbenchDemo(root: HTMLElement) {
  return wireReviewWorkbench(root, id, state);
}
