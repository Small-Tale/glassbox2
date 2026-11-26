import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import '@kerfjs/ui/catalog.css';
import '@kerfjs/ui/popup-menu/register';
import './style.css';

import { Catalog, type CatalogBackgroundStyle, CatalogExample } from '@kerfjs/ui/catalog';
import { Text } from '@kerfjs/ui/text';
import { wireCatalog } from '@kerfjs/ui/wire-catalog';
import { effect, mount, signal } from 'kerfjs';

import {
  componentDemos,
  defaultEntry,
  demoIdOf,
  graph,
  primarySections,
  resolveCatalogId,
  secondaryGroups,
} from './catalog.js';
import { wireAnalysisControlsDemo } from './demos/analysis/analysis-controls.js';
import { wireDiffFindControlsDemo } from './demos/diff/diff-find-controls.js';
import { wireMediaDiffDemo } from './demos/diff/media-diff.js';
import { wireTextDiffDemo } from './demos/diff/text-diff.js';
import { wireDiscussionDemo } from './demos/discussion/discussion.js';
import { wireSavedReviewDialogDemo } from './demos/discussion/saved-review-dialog.js';
import { wireExportDialogDemo } from './demos/handoff/export-dialog.js';
import { wireShareMenuDemo } from './demos/handoff/share-menu.js';
import { wireReviewNavigatorDemo } from './demos/review/review-navigator.js';
import { wireReviewWorkbenchDemo } from './demos/review/review-workbench.js';
import { wireAnalysisSettingsDialogDemo } from './demos/settings/analysis-settings-dialog.js';
import { wireAppearanceMenuDemo } from './demos/settings/appearance-menu.js';
import { wireRendererDialogDemo } from './demos/settings/renderer-dialog.js';
import { wireStorageDialogDemo } from './demos/settings/storage-dialog.js';

const urlParam = 'component';
// HS2-S9EG8B: ids are qualified by Kerf's composed catalog; a bare Glassbox id from an older link still resolves.
const initial = resolveCatalogId(new URLSearchParams(location.search).get(urlParam)) ?? defaultEntry;
const active = signal(initial);
const expandedGroups = signal<ReadonlySet<string>>(new Set([graph.entries.get(initial)?.package ?? '']));
const showDiscouraged = signal(false);
const discouragedGroup = '@awesome.me/webawesome';
const theme = signal<'light' | 'dark'>(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const contrast = signal(false);
const reducedMotion = signal(false);
const background = signal<CatalogBackgroundStyle>('checkerboard');
const collapsed = signal(false);
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

void effect(() => {
  const page = document.documentElement;
  page.dataset.kuiScheme = theme.value;
  // HS2-T9J9BE: Kerf's shared increased-contrast preview; the OS `prefers-contrast` behavior stays active.
  if (contrast.value) page.dataset.kuiContrast = 'more';
  else delete page.dataset.kuiContrast;
  page.classList.toggle('catalog-reduced-motion', reducedMotion.value);
});

mount(root, () => {
  const id = active.value;
  const demo = demoIdOf(id);
  return (
    <Catalog
      brand={{ title: 'Glassbox', subtitle: 'Component Catalog' }}
      sections={primarySections}
      active={id}
      secondarySections={secondaryGroups.map((group) => ({
        ...group,
        collapsible: true,
        expanded: expandedGroups.value.has(group.id),
        tagFilter:
          group.id === discouragedGroup
            ? { tag: 'Discouraged', label: 'Show Discouraged', show: showDiscouraged.value }
            : undefined,
      }))}
      content={
        demo === undefined ? (
          <CatalogExample label="Library Reference">
            <Text>This library entry has no Glassbox preview. Its demo, source and guidance are linked below.</Text>
          </CatalogExample>
        ) : (
          componentDemos[demo]()
        )
      }
      collapsed={collapsed.value}
      theme={theme.value}
      increasedContrast={contrast.value}
      reducedMotion={reducedMotion.value}
      backgroundControl
      backgroundStyle={background.value}
    />
  );
});
void wireCatalog(root, {
  onSelect: (id) => {
    const owner = graph.entries.get(id)?.package;
    if (owner === undefined) return;
    if (!expandedGroups.peek().has(owner)) expandedGroups.value = new Set([...expandedGroups.peek(), owner]);
    active.value = id;
  },
  onToggleSecondary: (id) => {
    if (id === undefined) return;
    const next = new Set(expandedGroups.peek());
    if (!next.delete(id)) next.add(id);
    expandedGroups.value = next;
  },
  onToggleSecondaryFilter: (show) => {
    showDiscouraged.value = show;
  },
  onToggleSidebar: () => {
    collapsed.value = !collapsed.value;
  },
  onToggleTheme: () => {
    theme.value = theme.value === 'light' ? 'dark' : 'light';
  },
  onToggleContrast: () => {
    contrast.value = !contrast.value;
  },
  onToggleMotion: () => {
    reducedMotion.value = !reducedMotion.value;
  },
  onSelectBackground: (style) => {
    background.value = style;
  },
  urlParam,
  revealSelection: true,
  collapsed,
});

void wireReviewWorkbenchDemo(root);

void wireReviewNavigatorDemo(root);

void wireDiffFindControlsDemo(root);
void wireTextDiffDemo(root);
void wireMediaDiffDemo(root);

void wireAnalysisControlsDemo(root);

void wireDiscussionDemo(root);
void wireSavedReviewDialogDemo(root);

void wireShareMenuDemo(root);

void wireExportDialogDemo(root);

void wireAppearanceMenuDemo(root);
void wireAnalysisSettingsDialogDemo(root);

void wireRendererDialogDemo(root);
void wireStorageDialogDemo(root);
