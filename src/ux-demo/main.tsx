import '@kerfjs/ui/document.css';
import '@kerfjs/ui/layout.css';
import '@kerfjs/ui/catalog.css';
import './style.css';

import { Catalog, type CatalogSection } from '@kerfjs/ui/catalog';
import { wireCatalog } from '@kerfjs/ui/wire-catalog';
import { mount, signal } from 'kerfjs';

import { ButtonDemo } from './demos/button.js';

const sections: CatalogSection[] = [
  {
    category: 'Components',
    entries: [{ id: 'button', name: 'Button', description: 'A pressable action.' }],
  },
];
const active = signal('button');
const collapsed = signal(false);
const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

mount(root, () => (
  <Catalog
    brand={{ title: 'Your app', subtitle: 'UX demo' }}
    sections={sections}
    active={active.value}
    content={<ButtonDemo />}
    collapsed={collapsed.value}
  />
));
wireCatalog(root, {
  onSelect: (id) => {
    active.value = id;
  },
  onToggleSidebar: () => {
    collapsed.value = !collapsed.value;
  },
  collapsed,
});
