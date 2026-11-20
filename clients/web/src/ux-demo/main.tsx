import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import '@kerfjs/ui/catalog.css';
import '@kerfjs/ui/popup-menu/register';
import './style.css';

import { Catalog, type CatalogBackgroundStyle } from '@kerfjs/ui/catalog';
import { wireCatalog } from '@kerfjs/ui/wire-catalog';
import { effect, mount, signal } from 'kerfjs';

import { catalogSections, componentDemos, type DemoId, isDemoId } from './catalog.js';
import { wireTextDiffDemo } from './demos/diff/text-diff.js';
import { wireReviewNavigatorDemo } from './demos/review/review-navigator.js';
import { wireReviewWorkbenchDemo } from './demos/review/review-workbench.js';
import { wireAppearanceMenuDemo } from './demos/settings/appearance-menu.js';

const urlParam = 'component';
const initial = new URLSearchParams(location.search).get(urlParam);
const active = signal<DemoId>(initial !== null && isDemoId(initial) ? initial : 'source-context');
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

mount(root, () => (
  <Catalog
    brand={{ title: 'Glassbox', subtitle: 'Component Catalog' }}
    sections={catalogSections}
    active={active.value}
    content={componentDemos[active.value]()}
    collapsed={collapsed.value}
    theme={theme.value}
    increasedContrast={contrast.value}
    reducedMotion={reducedMotion.value}
    backgroundControl
    backgroundStyle={background.value}
  />
));
void wireCatalog(root, {
  onSelect: (id) => {
    if (isDemoId(id)) active.value = id;
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

void wireAppearanceMenuDemo(root);
