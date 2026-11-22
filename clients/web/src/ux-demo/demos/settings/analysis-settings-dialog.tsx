import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import {
  AnalysisSettingsAction,
  AnalysisSettingsDialog,
  wireAnalysisSettingsDialog,
} from '../../../components/settings/analysis-settings-dialog.js';
import {
  type AnalysisPreferences,
  createAnalysisSettingsState,
} from '../../../components/settings/analysis-settings-state.js';

const id = 'demo-analysis-settings';
let preferences: AnalysisPreferences = { provider: 'desktop', model: null, guidance_topics: ['testing'] };
const state = createAnalysisSettingsState(
  () =>
    Promise.resolve({
      preferences,
      providers: [{ id: 'desktop', name: 'Desktop Adapter', executable: '/opt/glassbox/desktop-adapter' }],
    }),
  () => Promise.resolve(['Standard', 'Compact']),
  (value) => {
    preferences = value;
    return Promise.resolve();
  },
);
void state.refresh();

export function AnalysisSettingsDialogDemo() {
  return (
    <CatalogExampleStack label="AI Settings" rootAttributes={{ 'data-demo': 'analysis-settings-dialog' }}>
      <CatalogExample label="Toolbar Action">
        <AnalysisSettingsAction id={id} />
      </CatalogExample>
      <CatalogExample label="Provider and Guidance Preferences" viewport={{ width: 'full' }}>
        <AnalysisSettingsDialog id={id} state={state} embedded />
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireAnalysisSettingsDialogDemo(root: HTMLElement) {
  return wireAnalysisSettingsDialog(root, id, state);
}
