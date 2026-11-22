import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import {
  createSavedReviewState,
  SavedReviewDialog,
  wireSavedReviewDialog,
} from '../../../components/discussion/saved-review-dialog.js';
import type { ReviewSource } from '../../../components/review/review-source.js';

const id = 'demo-saved-reviews';
const source: ReviewSource = { kind: 'paths', before: 'before', after: 'after' };
const changedPaths = new Set(['src/settings.ts']);
const state = createSavedReviewState((_source, review) =>
  Promise.resolve({
    reviews: [{ id: 'review-Example', updated_at: 1_790_000_000 }],
    active: review !== undefined,
    paths: review === undefined ? [] : ['src/settings.ts', 'src/format.ts'],
  }),
);
void state.update(source);

export function SavedReviewDialogDemo() {
  return (
    <CatalogExampleStack label="Saved Reviews" rootAttributes={{ 'data-demo': 'saved-review-dialog' }}>
      <CatalogExample label="Reopen and Find Stale Discussions" viewport={{ width: 'full' }}>
        <SavedReviewDialog id={id} state={state} changedPaths={changedPaths} embedded />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireSavedReviewDialogDemo(root: HTMLElement) {
  return wireSavedReviewDialog(
    root,
    id,
    state,
    () => source,
    () => changedPaths,
    () => {},
    () => Promise.resolve(false),
  ).dispose;
}
