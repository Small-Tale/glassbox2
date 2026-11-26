import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { diffBlocks, noExpansion } from '../../../components/diff/context-expansion.js';
import { createFindState, findMatches, findReadout, findResult } from '../../../components/diff/diff-find.js';
import { DiffFindControls, wireDiffFind } from '../../../components/diff/diff-find-controls.js';
import {
  createTextDiffState,
  TextDiff,
  TextDiffToolbar,
  wireContextExpander,
  wireTextDiffToolbar,
} from '../../../components/diff/text-diff.js';
import type { DiffLine, TextHunk } from '../../../components/diff/text-diff-model.js';

const id = 'catalog-diff-find';
const find = createFindState();
const diffState = createTextDiffState();
const line = (kind: DiffLine['kind'], before: number | null, after: number | null, text: string): DiffLine => ({
  kind,
  before_line: before,
  after_line: after,
  text,
  ends_with_newline: true,
});
const hunks: TextHunk[] = [
  {
    before_start: 1,
    before_count: 4,
    after_start: 1,
    after_count: 5,
    lines: [
      line('context', 1, 1, 'const needle = lookup(key);'),
      line('removed', 2, null, 'return needle.value;'),
      line('added', null, 2, 'if (needle === undefined) return fallback;'),
      line('added', null, 3, 'return needle.value; // Needle found'),
      line('context', 3, 4, 'export { lookup };'),
      line('context', 4, 5, 'const NEEDLE_LIMIT = 8;'),
    ],
  },
];

// Type in the field to search this small diff for real; the Text Diff demo searches a longer one with hidden lines.
export function DiffFindControlsDemo() {
  const found = findResult(diffBlocks(hunks, undefined, noExpansion), find.query.value, find.current.value);
  return (
    <CatalogExampleStack label="Diff Find Controls" rootAttributes={{ 'data-demo': 'diff-find-controls' }}>
      <CatalogExample label="Find in a Diff" viewport={{ width: 'medium' }}>
        <TextDiffToolbar id={id} state={diffState} />
        <DiffFindControls id={id} state={find} readout={findReadout(found)} matches={found.matches.length} />
        <TextDiff hunks={hunks} path="src/lookup.ts" state={diffState} find={found} />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireDiffFindControlsDemo(root: HTMLElement) {
  const stopFind = wireDiffFind(
    root,
    id,
    find,
    () => findMatches(diffBlocks(hunks, undefined, noExpansion), find.query.peek()).length,
  );
  const stopToolbar = wireTextDiffToolbar(root, id, diffState);
  // This diff shows every line it has, so there is nothing for the unchanged-line controls to reveal.
  const stopContext = wireContextExpander(root, id, () => undefined);
  return () => {
    stopContext();
    stopToolbar();
    stopFind();
  };
}
