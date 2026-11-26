import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

import { ContextExpander } from '../../../components/diff/context-expander.js';
import type { Gap } from '../../../components/diff/context-expansion.js';

const id = 'catalog-context-expander';
const between: Gap = { index: 1, start: 27, end: 79, delta: -2, hasAbove: true, hasBelow: true };
const head: Gap = { index: 0, start: 1, end: 26, delta: 0, hasAbove: true, hasBelow: false };
const tail: Gap = { index: 2, start: 80, end: 106, delta: -2, hasAbove: false, hasBelow: true };

// Every state the controls take. The live behavior runs in the Text Diff demo, which wires them to a fixture file.
export function ContextExpanderDemo() {
  return (
    <CatalogExampleStack label="Context Expander" rootAttributes={{ 'data-demo': 'context-expander' }}>
      <CatalogExample label="Between Hunks" viewport={{ width: 'medium' }}>
        <ContextExpander id={id} gap={between} hidden={53} pending={false} error={null} />
      </CatalogExample>
      <CatalogExample label="Before the First Change" viewport={{ width: 'medium' }}>
        <ContextExpander id={id} gap={head} hidden={26} pending={false} error={null} />
      </CatalogExample>
      <CatalogExample label="After the Last Change" viewport={{ width: 'medium' }}>
        <ContextExpander id={id} gap={tail} hidden={27} pending={false} error={null} />
      </CatalogExample>
      <CatalogExample label="Short Gap" viewport={{ width: 'medium' }}>
        <ContextExpander id={id} gap={between} hidden={6} pending={false} error={null} />
      </CatalogExample>
      <CatalogExample label="One Line" viewport={{ width: 'medium' }}>
        <ContextExpander id={id} gap={between} hidden={1} pending={false} error={null} />
      </CatalogExample>
      <CatalogExample label="Loading" viewport={{ width: 'medium' }}>
        <ContextExpander id={id} gap={between} hidden={6} pending error={null} />
      </CatalogExample>
      <CatalogExample label="Source Changed" viewport={{ width: 'medium' }}>
        <ContextExpander
          id={id}
          gap={between}
          hidden={53}
          pending={false}
          error="The file changed after it was opened. Open the comparison again."
        />
      </CatalogExample>
    </CatalogExampleStack>
  );
}
