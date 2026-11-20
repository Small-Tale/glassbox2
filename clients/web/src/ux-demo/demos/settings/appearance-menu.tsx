import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { AppearanceMenu, wireAppearanceMenu } from '../../../components/settings/appearance-menu.js';
import { createAppearanceState } from '../../../components/settings/appearance-state.js';

const id = 'catalog-appearance-menu';
const state = createAppearanceState(
  () => Promise.resolve('system'),
  () => Promise.resolve(),
);

export function AppearanceMenuDemo() {
  const selected = state.appearance.value;
  return (
    <CatalogExampleStack rootAttributes={{ 'data-demo': 'appearance-menu' }}>
      <CatalogExample label="Appearance Menu" viewport={{ width: 'sidebar' }}>
        <div data-kui-scheme={selected === 'system' ? undefined : selected}>
          <AppearanceMenu id={id} state={state} />
        </div>
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireAppearanceMenuDemo(root: HTMLElement) {
  return wireAppearanceMenu(root, id, state);
}
