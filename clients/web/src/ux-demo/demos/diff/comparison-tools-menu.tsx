import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';
import { Text } from '@kerfjs/ui/text';
import { Toolbar } from '@kerfjs/ui/toolbar';
import { signal } from 'kerfjs';
import { Columns2, ListTree, Rows2, Search, WrapText } from 'lucide';

import { ComparisonToolsMenu, wireComparisonToolsMenu } from '../../../components/diff/comparison-tools-menu.js';

const id = 'demo-comparison-tools';
const chosen = signal('Nothing chosen yet.');
const wrap = signal(true);

export function ComparisonToolsMenuDemo() {
  return (
    <CatalogExampleStack label="More Tools" rootAttributes={{ 'data-demo': 'comparison-tools-menu' }}>
      <CatalogExample label="Narrow Toolbar" viewport={{ width: 'sidebar' }}>
        <Toolbar
          label="Comparison"
          trailing={
            <ComparisonToolsMenu
              id={id}
              tools={[
                { action: 'demo:find', label: 'Find in Diff', icon: Search, iconName: 'search' },
                { action: 'demo:split', label: 'Side by Side', icon: Columns2, iconName: 'columns-2', checked: false },
                { action: 'demo:inline', label: 'Inline', icon: Rows2, iconName: 'rows-2', checked: true },
                { action: 'demo:wrap', label: 'Wrap', icon: WrapText, iconName: 'wrap-text', checked: wrap.value },
                {
                  action: 'demo:outline',
                  label: 'Symbol Outline',
                  icon: ListTree,
                  iconName: 'list-tree',
                  disabled: true,
                },
              ]}
            />
          }
        />
      </CatalogExample>
      <CatalogExample label="Chosen Entry">
        <Text role="status" rootAttributes={{ 'data-demo-tools-result': '' }}>
          {chosen.value}
        </Text>
      </CatalogExample>
    </CatalogExampleStack>
  );
}

export function wireComparisonToolsMenuDemo(root: HTMLElement) {
  // The application's entries activate toolbar controls; the demo has none, so each records its own choice.
  const record = (label: string, change?: () => void) => () => {
    change?.();
    chosen.value = `${label} chosen.`;
  };
  return wireComparisonToolsMenu(root, id, {
    'demo:find': record('Find in Diff'),
    'demo:split': record('Side by Side'),
    'demo:inline': record('Inline'),
    'demo:wrap': record('Wrap', () => {
      wrap.value = !wrap.value;
    }),
  });
}
