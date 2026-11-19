import type { CatalogSection } from '@kerfjs/ui/catalog';
import type { SafeHtml } from 'kerfjs';

import metadata from '../../component-catalog.json';
import { SourceContextDemo } from './demos/review/source-context.js';

export const componentDemos = {
  'source-context': SourceContextDemo,
} satisfies Record<string, () => SafeHtml>;

export type DemoId = keyof typeof componentDemos;

export function isDemoId(value: string): value is DemoId {
  return Object.hasOwn(componentDemos, value);
}

export const catalogSections: CatalogSection[] = [
  {
    category: 'Review Workbench',
    entries: metadata.entries.map(({ id, name, purpose }) => ({ id, name, description: purpose })),
  },
];
