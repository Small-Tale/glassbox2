import type { CatalogSection } from '@kerfjs/ui/catalog';
import type { SafeHtml } from 'kerfjs';

import metadata from '../../component-catalog.json';
import { ReviewWorkbenchDemo } from './demos/review/review-workbench.js';
import { SourceContextDemo } from './demos/review/source-context.js';

export const componentDemos = {
  'source-context': SourceContextDemo,
  'review-workbench': ReviewWorkbenchDemo,
} satisfies Record<string, () => SafeHtml>;

export type DemoId = keyof typeof componentDemos;

export function isDemoId(value: string): value is DemoId {
  return Object.hasOwn(componentDemos, value);
}

export const catalogSections: CatalogSection[] = [
  {
    category: 'Review Workbench',
    entries: metadata.entries.map(({ id, name, purpose, kind }) => ({
      id,
      name,
      description: purpose,
      tags: kind === 'composition' ? ['Composition'] : undefined,
    })),
  },
];
