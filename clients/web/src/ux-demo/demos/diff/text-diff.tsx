import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { EmptyState } from '@kerfjs/ui/empty-state';

import {
  createTextDiffState,
  TextDiff,
  TextDiffToolbar,
  wireTextDiffToolbar,
} from '../../../components/diff/text-diff.js';
import type { TextHunk } from '../../../components/diff/text-diff-model.js';
import {
  createReviewWorkbenchState,
  ReviewWorkbench,
  wireReviewWorkbench,
} from '../../../components/review/review-workbench.js';
import { SourceContext } from '../../../components/review/source-context.js';

const id = 'catalog-text-diff';
const workbench = createReviewWorkbenchState();
const state = createTextDiffState();
const hunks: TextHunk[] = [
  {
    before_start: 21,
    before_count: 4,
    after_start: 21,
    after_count: 6,
    lines: [
      {
        before_line: 21,
        after_line: 21,
        kind: 'context',
        text: 'export async function writeBundle(review: Review) {',
        ends_with_newline: true,
      },
      {
        before_line: 22,
        after_line: 22,
        kind: 'context',
        text: '  const path = bundlePath(review.id);',
        ends_with_newline: true,
      },
      {
        before_line: 23,
        after_line: null,
        kind: 'removed',
        text: '  await writeFile(path, serialize(review));',
        ends_with_newline: true,
      },
      {
        before_line: null,
        after_line: 23,
        kind: 'added',
        text: '  const temporary = path + ".tmp";',
        ends_with_newline: true,
      },
      {
        before_line: null,
        after_line: 24,
        kind: 'added',
        text: '  await writeFile(temporary, serialize(review));',
        ends_with_newline: true,
      },
      {
        before_line: null,
        after_line: 25,
        kind: 'added',
        text: '  await rename(temporary, path);',
        ends_with_newline: true,
      },
      { before_line: 24, after_line: 26, kind: 'context', text: '}', ends_with_newline: true },
    ],
  },
];

export function TextDiffDemo() {
  return (
    <CatalogExampleStack width="full" rootAttributes={{ 'data-demo': 'text-diff' }}>
      <CatalogExample label="Text Review" viewport={{ width: 'full', height: 'app', frame: 'solid' }}>
        <ReviewWorkbench
          id={id}
          state={workbench}
          projectTitle="Fieldnotes"
          comparisonTitle="bundle.ts"
          inspectorTitle="Inspector"
          navigator={<SourceContext identity="feature/review-bundles" comparison="Working tree" />}
          comparison={<TextDiff hunks={hunks} path="src/bundle.ts" state={state} />}
          comparisonToolbar={<TextDiffToolbar id={id} state={state} />}
          inspector={<EmptyState title="No Discussion Selected" />}
        />
      </CatalogExample>
      <CatalogExample label="Read-Only Definition" viewport={{ width: 'full' }}>
        <TextDiff
          hunks={[]}
          path="src/bundle.ts"
          state={state}
          definition={{
            path: 'src/bundle.ts',
            side: 'before',
            revision: 'fixture',
            diff_revision: null,
            line: 2,
            index: null,
            text: 'type ReviewId = string;\nexport function bundlePath(id: ReviewId) {\n  return id + ".md";\n}',
          }}
          snapshot
        />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireTextDiffDemo(root: HTMLElement) {
  const stopView = wireReviewWorkbench(root, id, workbench);
  const stopToolbar = wireTextDiffToolbar(root, id, state);
  return () => {
    stopToolbar();
    stopView();
  };
}
