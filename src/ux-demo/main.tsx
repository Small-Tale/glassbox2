import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import '@kerfjs/ui/catalog.css';
import './style.css';

import { Catalog } from '@kerfjs/ui/catalog';
import { wireCatalog } from '@kerfjs/ui/wire-catalog';
import { mount, signal } from 'kerfjs';

import { catalogSections, componentDemos, type DemoId, isDemoId } from './catalog.js';
import { wireReviewWorkbenchDemo } from './demos/review/review-workbench.js';

const active = signal<DemoId>('source-context');
const collapsed = signal(false);
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

mount(root, () => (
  <Catalog
    brand={{ title: 'Glassbox', subtitle: 'Component Catalog' }}
    sections={catalogSections}
    active={active.value}
    content={componentDemos[active.value]()}
    collapsed={collapsed.value}
  />
));
void wireCatalog(root, {
  onSelect: (id) => {
    if (isDemoId(id)) active.value = id;
  },
  onToggleSidebar: () => {
    collapsed.value = !collapsed.value;
  },
  collapsed,
});

void wireReviewWorkbenchDemo(root);
