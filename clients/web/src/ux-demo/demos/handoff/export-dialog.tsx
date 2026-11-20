import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { ExportDialog, wireExportDialog } from '../../../components/handoff/export-dialog.js';
import { createExportState, type ExportPreview } from '../../../components/handoff/export-state.js';

const id = 'demo-hot-sheet-export';
const preview: ExportPreview = {
  destination: { name: 'Fieldnotes', path: 'Fieldnotes.hs2' },
  recent: [{ slug: 'FN-4QX8M2', title: 'Make review bundle writes atomic', status: 'started' }],
  feedback: {
    threads: 2,
    replies: 3,
    attachments: 1,
    paths: ['src/bundle.ts'],
    entries: [
      { id: 1, revision: 3, path: 'src/bundle.ts', excerpt: 'Use an atomic replacement.', replies: 2, attachments: 1 },
      { id: 2, revision: 2, path: 'src/bundle.ts', excerpt: 'Cover simultaneous writes.', replies: 1, attachments: 0 },
    ],
  },
  message: null,
};
const state = createExportState(
  () => Promise.resolve(preview),
  () => Promise.resolve({ ticket: 'FN-4QX8M2', batch_id: 'example' }),
);
void state.open({ kind: 'difftool' }, () => Promise.resolve(true));

export function ExportDialogDemo() {
  return (
    <CatalogExampleStack label="Hot Sheet Export" rootAttributes={{ 'data-demo': 'export-dialog' }}>
      <CatalogExample label="Full Review Delivery" viewport={{ width: 'full' }}>
        <ExportDialog id={id} state={state} embedded />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireExportDialogDemo(root: HTMLElement) {
  return wireExportDialog(root, id, state).stop;
}
