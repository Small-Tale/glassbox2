import { catalogEntryId, type CatalogPackage, composeCatalog } from '@kerfjs/ui/catalog';
import { kerfCatalogPackage } from '@kerfjs/ui/catalog-library';
import { catalogResources } from '@kerfjs/ui/catalog-resources';
import type { SafeHtml } from 'kerfjs';

import metadata from '../../component-catalog.json';
import { AnalysisControlsDemo } from './demos/analysis/analysis-controls.js';
import { ContextExpanderDemo } from './demos/diff/context-expander.js';
import { DiffFindControlsDemo } from './demos/diff/diff-find-controls.js';
import { MediaDiffDemo } from './demos/diff/media-diff.js';
import { TextDiffDemo } from './demos/diff/text-diff.js';
import { DiscussionDemo } from './demos/discussion/discussion.js';
import { RelocationOfferDemo } from './demos/discussion/relocation-offer.js';
import { SavedReviewDialogDemo } from './demos/discussion/saved-review-dialog.js';
import { ExportDialogDemo } from './demos/handoff/export-dialog.js';
import { ShareMenuDemo } from './demos/handoff/share-menu.js';
import { ReviewNavigatorDemo } from './demos/review/review-navigator.js';
import { ReviewWorkbenchDemo } from './demos/review/review-workbench.js';
import { SourceContextDemo } from './demos/review/source-context.js';
import { AnalysisSettingsDialogDemo } from './demos/settings/analysis-settings-dialog.js';
import { AppearanceMenuDemo } from './demos/settings/appearance-menu.js';
import { RendererDialogDemo } from './demos/settings/renderer-dialog.js';
import { StorageDialogDemo } from './demos/settings/storage-dialog.js';

export const componentDemos = {
  'source-context': SourceContextDemo,
  'appearance-menu': AppearanceMenuDemo,
  'analysis-settings-dialog': AnalysisSettingsDialogDemo,
  'context-expander': ContextExpanderDemo,
  'diff-find-controls': DiffFindControlsDemo,
  'text-diff': TextDiffDemo,
  'media-diff': MediaDiffDemo,
  'analysis-controls': AnalysisControlsDemo,
  'review-discussion': DiscussionDemo,
  'relocation-offer': RelocationOfferDemo,
  'saved-review-dialog': SavedReviewDialogDemo,
  'share-menu': ShareMenuDemo,
  'export-dialog': ExportDialogDemo,
  'renderer-dialog': RendererDialogDemo,
  'storage-dialog': StorageDialogDemo,
  'review-navigator': ReviewNavigatorDemo,
  'review-workbench': ReviewWorkbenchDemo,
} satisfies Record<string, () => SafeHtml>;

export type DemoId = keyof typeof componentDemos;

function isDemoId(value: string): value is DemoId {
  return Object.hasOwn(componentDemos, value);
}

const groups = [
  { category: 'Review Workbench', folder: 'review' },
  { category: 'Comparison', folder: 'diff' },
  { category: 'Analysis', folder: 'analysis' },
  { category: 'Discussion', folder: 'discussion' },
  { category: 'Handoff', folder: 'handoff' },
  { category: 'Settings', folder: 'settings' },
];

const repository = 'https://github.com/Small-Tale/glassbox2/blob/main/clients/web/';
const sourceLink = (path: string) => ({ href: new URL(path, repository).href, detail: path });
const localIds = new Set(metadata.entries.map(({ id }) => id));

// HS2-S9EG8B: Glassbox publishes one catalog package and imports Kerf's own library catalog, so Kerf
// composes the navigation groups and the Uses / Used by relationships, including the transitive libraries.
export const glassboxCatalog: CatalogPackage = {
  package: metadata.package,
  label: 'Glassbox',
  imports: [kerfCatalogPackage],
  entries: groups.flatMap(({ category, folder }) =>
    metadata.entries
      .filter(({ source }) => source.startsWith(`src/components/${folder}/`))
      .sort(
        (first, second) =>
          Number(first.kind === 'composition') - Number(second.kind === 'composition') ||
          first.name.localeCompare(second.name),
      )
      .map(({ id, name, purpose, kind, uses, source, demoSource, documentation }) => ({
        id,
        name,
        category,
        description: purpose,
        tags: kind === 'composition' ? ['Composition'] : undefined,
        uses: (uses ?? []).map((use) => (localIds.has(use) ? use : { package: kerfCatalogPackage.package, id: use })),
        resources: catalogResources({
          demoSource: sourceLink(demoSource),
          componentSource: sourceLink(source),
          guidance: sourceLink(documentation),
        }),
      })),
  ),
};

export const graph = composeCatalog(glassboxCatalog);
export const primarySections = graph.groups.find(({ id }) => id === glassboxCatalog.package)?.sections ?? [];
export const secondaryGroups = graph.groups.filter(({ id }) => id !== glassboxCatalog.package);
export const defaultEntry = catalogEntryId(glassboxCatalog.package, 'source-context');

/** Accepts a qualified route id or a bare Glassbox id from an older link. */
export function resolveCatalogId(value: string | null): string | undefined {
  if (value === null) return undefined;
  if (graph.entries.has(value)) return value;
  const local = catalogEntryId(glassboxCatalog.package, value);
  return graph.entries.has(local) ? local : undefined;
}

export function demoIdOf(id: string): DemoId | undefined {
  const entry = graph.entries.get(id);
  if (entry?.package !== glassboxCatalog.package) return undefined;
  const local = id.slice(entry.package.length + 1);
  return isDemoId(local) ? local : undefined;
}
