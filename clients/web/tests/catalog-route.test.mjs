import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';

import { createServer as createViteServer } from 'vite';

test('HS2-6S9HC3 opens the catalog from its bare route in Vite', async () => {
  const vite = await createViteServer({
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false },
  });
  const server = createServer(vite.middlewares);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${origin}/ux-demo?view=catalog`);
    assert.equal(response.url, `${origin}/ux-demo/?view=catalog`);
    assert.match(await response.text(), /<title>Glassbox Component Catalog<\/title>/);
    const app = await fetch(origin);
    assert.match(await app.text(), /<title>Glassbox<\/title>/);
  } finally {
    server.close();
    await vite.close();
  }
});
