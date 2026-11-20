import type { CatalogEntry, CatalogSection } from '@kerfjs/ui/catalog';
import { catalogResources } from '@kerfjs/ui/catalog-resources';
import type { SafeHtml } from 'kerfjs';
import upstreamReferences from 'virtual:glassbox-kerf-references';

import metadata from '../../component-catalog.json';
import { TextDiffDemo } from './demos/diff/text-diff.js';
import { DiscussionDemo } from './demos/discussion/discussion.js';
import { ExportDialogDemo } from './demos/handoff/export-dialog.js';
import { ShareMenuDemo } from './demos/handoff/share-menu.js';
import { ReviewNavigatorDemo } from './demos/review/review-navigator.js';
import { ReviewWorkbenchDemo } from './demos/review/review-workbench.js';
import { SourceContextDemo } from './demos/review/source-context.js';
import { AppearanceMenuDemo } from './demos/settings/appearance-menu.js';

export const componentDemos = {
  'source-context': SourceContextDemo,
  'appearance-menu': AppearanceMenuDemo,
  'text-diff': TextDiffDemo,
  'review-discussion': DiscussionDemo,
  'share-menu': ShareMenuDemo,
  'export-dialog': ExportDialogDemo,
  'review-navigator': ReviewNavigatorDemo,
  'review-workbench': ReviewWorkbenchDemo,
} satisfies Record<string, () => SafeHtml>;

export type DemoId = keyof typeof componentDemos;

export const kerfReferences = new Map(upstreamReferences.map((entry) => [entry.id, entry]));

export function isCatalogId(id: string): boolean {
  return isDemoId(id) || kerfReferences.has(id);
}

export function isDemoId(value: string): value is DemoId {
  return Object.hasOwn(componentDemos, value);
}

const groups = [
  { category: 'Review Workbench', folder: 'review' },
  { category: 'Comparison', folder: 'diff' },
  { category: 'Discussion', folder: 'discussion' },
  { category: 'Handoff', folder: 'handoff' },
  { category: 'Settings', folder: 'settings' },
];

const kerfBase = 'https://github.com/brianwestphal/kerf/blob/main/ui/';
const entries: { id: string; name: string; uses?: readonly string[] }[] = [
  ...metadata.entries,
  ...kerfReferences.values(),
];

function relatedEntries(id: string, uses: readonly string[] = []) {
  return [
    ...entries.filter((entry) => uses.includes(entry.id)).map(({ id, name }) => ({ id, name, group: 'Uses' })),
    ...entries
      .filter((entry) => entry.uses?.includes(id) === true)
      .map(({ id, name }) => ({ id, name, group: 'Used by' })),
  ];
}

export const kerfSections: CatalogSection[] = [];
for (const { id, name, category, description, documentation, uses } of kerfReferences.values()) {
  const entry: CatalogEntry = {
    id,
    name,
    description,
    related: relatedEntries(id, uses),
    resources: [{ label: 'Kerf UI Documentation', href: new URL(documentation, kerfBase).href }],
  };
  const existing = kerfSections.find((section) => section.category === category);
  if (existing === undefined) kerfSections.push({ category, entries: [entry] });
  else existing.entries = [...existing.entries, entry];
}

const repository = 'https://github.com/Small-Tale/glassbox2/blob/main/clients/web/';
const sourceLink = (path: string) => ({ href: new URL(path, repository).href, detail: path });

export const catalogSections: CatalogSection[] = groups.map(({ category, folder }) => ({
  category,
  entries: metadata.entries
    .filter(({ source }) => source.startsWith(`src/components/${folder}/`))
    .sort(
      (first, second) =>
        Number(first.kind === 'composition') - Number(second.kind === 'composition') ||
        first.name.localeCompare(second.name),
    )
    .map(({ id, name, purpose, kind, uses, source, demoSource, documentation }) => ({
      id,
      name,
      description: purpose,
      tags: kind === 'composition' ? ['Composition'] : undefined,
      related: relatedEntries(id, uses),
      resources: catalogResources({
        demoSource: sourceLink(demoSource),
        componentSource: sourceLink(source),
        guidance: sourceLink(documentation),
      }),
    })),
}));
