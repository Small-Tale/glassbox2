import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { EmptyState } from '@kerfjs/ui/empty-state';
import { signal } from 'kerfjs';

import {
  createContextExpansion,
  diffBlocks,
  resetContextOnChange,
} from '../../../components/diff/context-expansion.js';
import { createFindState, findMatches, findReadout, findResult } from '../../../components/diff/diff-find.js';
import { DiffFindControls, wireDiffFind } from '../../../components/diff/diff-find-controls.js';
import {
  createTextDiffState,
  TextDiff,
  TextDiffToolbar,
  wireContextExpander,
  wireTextDiffToolbar,
} from '../../../components/diff/text-diff.js';
import type { TextHunk } from '../../../components/diff/text-diff-model.js';
import { LineDiscussion, wireDiscussion } from '../../../components/discussion/discussion.js';
import { createDiscussionState, type Thread } from '../../../components/discussion/discussion-state.js';
import { createReviewSourceState, type ReviewFiles } from '../../../components/review/review-source.js';
import {
  createReviewWorkbenchState,
  ReviewWorkbench,
  wireReviewWorkbench,
} from '../../../components/review/review-workbench.js';
import { SourceContext } from '../../../components/review/source-context.js';

const id = 'catalog-text-diff';
const workbench = createReviewWorkbenchState();
const state = createTextDiffState();
const contextId = 'catalog-text-diff-context';
const findId = 'catalog-text-diff-find';
const find = createFindState();
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

const fileLines = 120;
const reviewFiles: ReviewFiles = {
  identity: 'Fieldnotes',
  branch: 'feature/review-bundles',
  comparison: 'Working tree',
  files: [{ path: 'src/bundle.ts', previous_path: null, status: 'modified' }],
};
// A thread on a line the diff hides: it appears with the line once the controls reveal it (HS2-DZ8ZR6).
const hiddenLineThread: Thread = {
  id: 1,
  revision: 1,
  anchor: { path: 'src/bundle.ts', side: 'after', revision: 'fixture', target: { kind: 'line', start: 50, end: 50 } },
  origin: { kind: 'reviewer', category: 'style' },
  opening: { author: 'Reviewer', markdown: 'This helper is easy to miss from the diff.', attachments: [] },
  replies: [],
};
// A second hunk far below the first leaves unchanged runs at the head, between the hunks and at the tail.
const farHunk: TextHunk = {
  before_start: 70,
  before_count: 3,
  after_start: 72,
  after_count: 3,
  lines: [
    { before_line: 70, after_line: 72, kind: 'context', text: '  return bundles;', ends_with_newline: true },
    { before_line: 71, after_line: null, kind: 'removed', text: '  cache.clear();', ends_with_newline: true },
    { before_line: null, after_line: 73, kind: 'added', text: '  cache.delete(review.id);', ends_with_newline: true },
    { before_line: 72, after_line: 74, kind: 'context', text: '}', ends_with_newline: true },
  ],
};
const discussion = createDiscussionState(
  createReviewSourceState(reviewFiles, () => Promise.resolve(reviewFiles)),
  () => Promise.resolve([hiddenLineThread]),
);
discussion.threads.value = [hiddenLineThread];
const demoHunks = [...hunks, farHunk];
const demoResult = signal<{ kind: 'text'; revision: string; hunks: TextHunk[]; after_lines: number }>({
  kind: 'text',
  revision: 'fixture',
  hunks: demoHunks,
  after_lines: fileLines,
});
// Deterministic lines stand in for the host so the controls run for real without an API call.
const context = createContextExpansion(
  demoResult,
  () => ({ source: { kind: 'paths', before: 'before', after: 'after' }, index: 0, path: 'src/bundle.ts' }),
  (_selection, _revision, range) =>
    Promise.resolve({
      lines: Array.from({ length: range.end - range.start + 1 }, (_, offset) => ({
        text: `  const unchanged${range.start + offset} = ${range.start + offset};`,
        ends_with_newline: true,
      })),
      total: fileLines,
    }),
);

export function TextDiffDemo() {
  const found = findResult(
    diffBlocks(demoHunks, fileLines, context.expansion.value),
    find.query.value,
    find.current.value,
  );
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
          comparison={
            <TextDiff
              hunks={demoHunks}
              path="src/bundle.ts"
              state={state}
              context={{ id: contextId, total: fileLines, expansion: context.expansion.value }}
              find={found}
              rowContent={(_before, after) => (
                <LineDiscussion
                  threads={discussion.threads.value.filter(
                    ({ anchor }) => anchor.target.kind === 'line' && anchor.target.start === after,
                  )}
                  active={discussion.threadId.value}
                />
              )}
            />
          }
          comparisonToolbar={
            <>
              <TextDiffToolbar id={id} state={state} />
              <DiffFindControls id={findId} state={find} readout={findReadout(found)} matches={found.matches.length} />
            </>
          }
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
  const stopContext = wireContextExpander(root, contextId, (gap, direction) => void context.expand(gap, direction));
  const stopReset = resetContextOnChange(context, demoResult);
  const stopFind = wireDiffFind(
    root,
    findId,
    find,
    () => findMatches(diffBlocks(demoHunks, fileLines, context.expansion.peek()), find.query.peek()).length,
  );
  const stopDiscussion = wireDiscussion(
    root,
    discussion,
    () => undefined,
    () => undefined,
  );
  return () => {
    stopFind();
    stopDiscussion();
    stopReset();
    stopContext();
    stopToolbar();
    stopView();
  };
}
