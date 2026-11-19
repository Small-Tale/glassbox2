import { Button } from '@kerfjs/ui/button';
import { CatalogExample, CatalogExampleStack } from '@kerfjs/ui/catalog';

export function ButtonDemo() {
  return (
    <CatalogExampleStack label="Button" rootAttributes={{ 'data-demo': 'button' }}>
      <CatalogExample label="Default" align="inline-control">
        <Button href="/">Back to App</Button>
      </CatalogExample>
    </CatalogExampleStack>
  );
}
