import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import '@kerfjs/ui/catalog.css';
import '@kerfjs/ui/popup-menu/register';
import './style.css';

import { Catalog, type CatalogBackgroundStyle, CatalogExample } from '@kerfjs/ui/catalog';
import { wireCatalog } from '@kerfjs/ui/wire-catalog';
import { effect, mount, signal } from 'kerfjs';

import { catalogSections, componentDemos, isCatalogId, isDemoId, kerfReferences, kerfSections } from './catalog.js';
import { wireAnalysisControlsDemo } from './demos/analysis/analysis-controls.js';
import { wireTextDiffDemo } from './demos/diff/text-diff.js';
import { wireDiscussionDemo } from './demos/discussion/discussion.js';
import { wireExportDialogDemo } from './demos/handoff/export-dialog.js';
import { wireShareMenuDemo } from './demos/handoff/share-menu.js';
import { wireReviewNavigatorDemo } from './demos/review/review-navigator.js';
import { wireReviewWorkbenchDemo } from './demos/review/review-workbench.js';
import { wireAppearanceMenuDemo } from './demos/settings/appearance-menu.js';
import { wireStorageDialogDemo } from './demos/settings/storage-dialog.js';

const urlParam = 'component';
const initial = new URLSearchParams(location.search).get(urlParam);
const active = signal(initial !== null && isCatalogId(initial) ? initial : 'source-context');
const kerfExpanded = signal(initial !== null && kerfReferences.has(initial));
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
  page.classList.toggle('catalog-contrast', contrast.value);
  page.classList.toggle('catalog-reduced-motion', reducedMotion.value);
});

mount(root, () => {
  const id = active.value;
  const reference = kerfReferences.get(id);
  return (
    <Catalog
      brand={{ title: 'Glassbox', subtitle: 'Component Catalog' }}
      sections={catalogSections}
      active={id}
      secondarySections={{ label: 'Kerf UI', sections: kerfSections, collapsible: true, expanded: kerfExpanded.value }}
      content={
        isDemoId(id) ? (
          componentDemos[id]()
        ) : (
          <CatalogExample label="Kerf UI Reference">
            <ul>
              {reference?.useWhen.map((guidance) => (
                <li>{guidance}</li>
              ))}
            </ul>
          </CatalogExample>
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
    if (!isCatalogId(id)) return;
    if (kerfReferences.has(id)) kerfExpanded.value = true;
    active.value = id;
  },
  onToggleSecondary: () => {
    kerfExpanded.value = !kerfExpanded.value;
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

void wireTextDiffDemo(root);

void wireAnalysisControlsDemo(root);

void wireDiscussionDemo(root);

void wireShareMenuDemo(root);

void wireExportDialogDemo(root);

void wireAppearanceMenuDemo(root);

void wireStorageDialogDemo(root);
