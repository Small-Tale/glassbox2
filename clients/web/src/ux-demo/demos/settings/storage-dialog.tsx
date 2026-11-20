import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { StorageDialog, wireStorageDialog } from '../../../components/settings/storage-dialog.js';
import { createStorageState, type Usage } from '../../../components/settings/storage-state.js';

const id = 'demo-feedback-storage';
let usage: Usage = {
  bytes: 48_000,
  bundles: 2,
  projects: [{ project: 'Fieldnotes', bytes: 48_000, bundles: 2 }],
};
const state = createStorageState(
  () => Promise.resolve(usage),
  () => {
    usage = { bytes: 0, bundles: 0, projects: [] };
    return Promise.resolve({ removed_bundles: 2, reclaimed_bytes: 48_000, active_bundles: 0, problems: [] });
  },
);
void state.refresh();

export function StorageDialogDemo() {
  return (
    <CatalogExampleStack label="Feedback Storage" rootAttributes={{ 'data-demo': 'storage-dialog' }}>
      <CatalogExample label="Usage and Cleanup" viewport={{ width: 'full' }}>
        <StorageDialog id={id} state={state} embedded />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireStorageDialogDemo(root: HTMLElement) {
  return wireStorageDialog(root, id, state);
}
