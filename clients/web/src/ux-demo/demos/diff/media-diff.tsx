import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { EmptyState } from '@kerfjs/ui/empty-state';

import {
  createMediaDiffState,
  MediaDiff,
  MediaDiffToolbar,
  wireMediaDiff,
} from '../../../components/diff/media-diff.js';
import {
  createReviewWorkbenchState,
  ReviewWorkbench,
  wireReviewWorkbench,
} from '../../../components/review/review-workbench.js';
import { SourceContext } from '../../../components/review/source-context.js';

const id = 'catalog-media-diff';
const workbench = createReviewWorkbenchState();
const state = createMediaDiffState();
function illustration(color: string) {
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#e7eaef"/><circle cx="160" cy="100" r="65" fill="${color}"/></svg>`;
  return {
    source,
    url: `data:image/svg+xml,${encodeURIComponent(source)}`,
    content_type: 'image/svg+xml',
    size: source.length,
    revision: color,
  };
}
const images = { before: illustration('#506b91'), after: illustration('#3b7c68') };

export function MediaDiffDemo() {
  return (
    <CatalogExampleStack width="full" rootAttributes={{ 'data-demo': 'media-diff' }}>
      <CatalogExample label="Image Review" viewport={{ width: 'full', height: 'app', frame: 'solid' }}>
        <ReviewWorkbench
          id={id}
          state={workbench}
          projectTitle="Fieldnotes"
          comparisonTitle="mark.svg"
          inspectorTitle="Inspector"
          navigator={<SourceContext identity="feature/review-bundles" comparison="Working tree" />}
          comparison={<MediaDiff id={id} images={images} state={state} />}
          comparisonToolbar={<MediaDiffToolbar id={id} images={images} state={state} />}
          inspector={<EmptyState title="No Discussion Selected" />}
        />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireMediaDiffDemo(root: HTMLElement) {
  const stopView = wireReviewWorkbench(root, id, workbench);
  const stopToolbar = wireMediaDiff(root, id, state);
  return () => {
    stopToolbar();
    stopView();
  };
}
