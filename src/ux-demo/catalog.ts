import type { CatalogSection } from '@kerfjs/ui/catalog';
import type { SafeHtml } from 'kerfjs';

import metadata from '../../component-catalog.json';
import { TextDiffDemo } from './demos/diff/text-diff.js';
import { ReviewNavigatorDemo } from './demos/review/review-navigator.js';
import { ReviewWorkbenchDemo } from './demos/review/review-workbench.js';
import { SourceContextDemo } from './demos/review/source-context.js';

export const componentDemos = {
  'source-context': SourceContextDemo,
  'text-diff': TextDiffDemo,
  'review-navigator': ReviewNavigatorDemo,
  'review-workbench': ReviewWorkbenchDemo,
} satisfies Record<string, () => SafeHtml>;

export type DemoId = keyof typeof componentDemos;

export function isDemoId(value: string): value is DemoId {
  return Object.hasOwn(componentDemos, value);
}

const groups = [
  { category: 'Review Workbench', folder: 'review' },
  { category: 'Comparison', folder: 'diff' },
];

export const catalogSections: CatalogSection[] = groups.map(({ category, folder }) => ({
  category,
  entries: metadata.entries
    .filter(({ source }) => source.startsWith(`src/components/${folder}/`))
    .map(({ id, name, purpose, kind }) => ({
      id,
      name,
      description: purpose,
      tags: kind === 'composition' ? ['Composition'] : undefined,
    })),
}));
