import '@kerfjs/ui/document.css';

import { Text } from '@kerfjs/ui/text';
import { mount } from 'kerfjs';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root.');

mount(root, () => (
  <main>
    <Text variant="h1">Your Kerf app</Text>
    <Text>Build your first feature in src/features.</Text>
    <a href="/ux-demo/">Open the UX demo</a>
  </main>
));
