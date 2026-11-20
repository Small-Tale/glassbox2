import { resolve } from 'node:path';
import { defineConfig } from 'vite';

function configureCatalogRoute(server) {
  server.middlewares.use((request, response, next) => {
    const url = request.url ?? '';
    const queryStart = url.indexOf('?');
    const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
    if (pathname !== '/ux-demo') return next();

    const query = queryStart === -1 ? '' : url.slice(queryStart);
    response.writeHead(308, { Location: `/ux-demo/${query}` });
    response.end();
  });
}

export default defineConfig({
  plugins: [
    {
      name: 'glassbox-catalog-route',
      configureServer: configureCatalogRoute,
      configurePreviewServer: configureCatalogRoute,
    },
  ],
  build: {
    rollupOptions: {
      input: {
        app: resolve(import.meta.dirname, 'index.html'),
        'ux-demo': resolve(import.meta.dirname, 'ux-demo/index.html'),
      },
    },
  },
});
