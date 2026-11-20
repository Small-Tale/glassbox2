import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { createHandoffState } from '../../../components/handoff/handoff-state.js';
import { ShareMenu, ShareStatus, wireShareMenu } from '../../../components/handoff/share-menu.js';
import type { ReviewSource } from '../../../components/review/review-source.js';

const id = 'demo-share';
const source: ReviewSource = { kind: 'paths', before: 'before', after: 'after' };
const state = createHandoffState(() => Promise.resolve('Example Glassbox review feedback instruction.'));

export function ShareMenuDemo() {
  return (
    <CatalogExampleStack label="Share Feedback" rootAttributes={{ 'data-demo': 'share-menu' }}>
      <CatalogExample label="Review Open">
        <ShareMenu id={id} state={state} ready />
        <ShareStatus state={state} />
      </CatalogExample>
      <CatalogExample label="No Review Open">
        <ShareMenu id="demo-share-idle" state={state} ready={false} />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireShareMenuDemo(root: HTMLElement) {
  return wireShareMenu(
    root,
    id,
    state,
    () => source,
    () => Promise.resolve(true),
  );
}
