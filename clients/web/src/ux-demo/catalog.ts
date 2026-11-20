import type { CatalogSection } from '@kerfjs/ui/catalog';
import { catalogResources } from '@kerfjs/ui/catalog-resources';
import type { SafeHtml } from 'kerfjs';

import metadata from '../../component-catalog.json';
import { TextDiffDemo } from './demos/diff/text-diff.js';
import { ReviewNavigatorDemo } from './demos/review/review-navigator.js';
import { ReviewWorkbenchDemo } from './demos/review/review-workbench.js';
import { SourceContextDemo } from './demos/review/source-context.js';
import { AppearanceMenuDemo } from './demos/settings/appearance-menu.js';

export const componentDemos = {
  'source-context': SourceContextDemo,
  'appearance-menu': AppearanceMenuDemo,
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
  { category: 'Settings', folder: 'settings' },
];

const repository = 'https://github.com/Small-Tale/glassbox2/blob/main/clients/web/';
const sourceLink = (path: string) => ({ href: new URL(path, repository).href, detail: path });

export const catalogSections: CatalogSection[] = groups.map(({ category, folder }) => ({
  category,
  entries: metadata.entries
    .filter(({ source }) => source.startsWith(`src/components/${folder}/`))
    .map(({ id, name, purpose, kind, uses, source, demoSource, documentation }) => ({
      id,
      name,
      description: purpose,
      tags: kind === 'composition' ? ['Composition'] : undefined,
      related: [
        ...metadata.entries
          .filter((entry) => uses?.includes(entry.id) === true)
          .map(({ id, name }) => ({ id, name, group: 'Uses' })),
        ...metadata.entries
          .filter((entry) => entry.uses?.includes(id) === true)
          .map(({ id, name }) => ({ id, name, group: 'Used by' })),
      ],
      resources: catalogResources({
        demoSource: sourceLink(demoSource),
        componentSource: sourceLink(source),
        guidance: sourceLink(documentation),
      }),
    })),
}));
