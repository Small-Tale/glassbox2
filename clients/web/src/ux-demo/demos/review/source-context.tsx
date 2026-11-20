import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { SourceContext } from '../../../components/review/source-context.js';

export function SourceContextDemo() {
  return (
    <CatalogExampleStack label="Review Source Context" rootAttributes={{ 'data-demo': 'source-context' }}>
      <CatalogExample label="Git Working Tree" viewport={{ width: 'sidebar' }}>
        <SourceContext identity="feature/review-bundles" comparison="Working tree" />
      </CatalogExample>
      <CatalogExample label="Folder Comparison" viewport={{ width: 'sidebar' }}>
        <SourceContext identity="release-candidate → next-release" comparison="Folder comparison" />
      </CatalogExample>
    </CatalogExampleStack>
  );
}
