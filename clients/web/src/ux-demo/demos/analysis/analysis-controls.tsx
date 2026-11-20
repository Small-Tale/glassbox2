import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import {
  AnalysisContext,
  AnalysisControls,
  wireAnalysisControls,
} from '../../../components/analysis/analysis-controls.js';
import { createAnalysisState } from '../../../components/analysis/analysis-state.js';

const id = 'demo-analysis-controls';
const selection = { path: 'src/bundle.ts', revision: 'sample' };
const state = createAnalysisState(() => undefined, {
  start: (_, mode) =>
    Promise.resolve({
      id: 1,
      status: 'complete',
      result: {
        files: [
          {
            ...selection,
            analysis:
              mode === 'risk'
                ? { kind: 'risk', rationale: 'Review concurrent writes.' }
                : {
                    kind: 'guidance',
                    overview: 'Review the new bundle writer.',
                    steps: [
                      { side: 'after', line: 23, text: 'Start with the temporary filename.' },
                      { side: 'after', line: 24, text: 'Check that writes use different paths.' },
                    ],
                  },
          },
        ],
        skipped: [],
      },
    }),
  status: () => Promise.resolve({ id: 1, status: 'unavailable', message: 'The provider is unavailable.' }),
  cancel: () => Promise.resolve({ id: 1, status: 'cancelled' }),
  wait: () => Promise.resolve(),
});
state.setSource({ kind: 'difftool' });
void state.toggle('guidance', selection);

export function AnalysisControlsDemo() {
  return (
    <CatalogExampleStack label="Review Analysis" rootAttributes={{ 'data-demo': 'analysis-controls' }}>
      <CatalogExample label="Independent Review Controls">
        <AnalysisControls id={id} state={state} />
        <AnalysisContext id={id} state={state} selection={selection} />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireAnalysisControlsDemo(root: HTMLElement) {
  return wireAnalysisControls(root, id, state, () => selection);
}
