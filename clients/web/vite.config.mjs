import { readFile } from 'node:fs/promises';
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

const referenceModule = 'virtual:glassbox-kerf-references';

const catalogReferences = {
  name: 'glassbox-kerf-references',
  resolveId(id) {
    if (id === referenceModule) return `\0${id}`;
  },
  async load(id) {
    if (id !== `\0${referenceModule}`) return;
    const localPath = resolve(import.meta.dirname, 'component-catalog.json');
    const upstreamPath = resolve(import.meta.dirname, 'node_modules/@kerfjs/ui/ai/component-catalog.json');
    this.addWatchFile(localPath);
    this.addWatchFile(upstreamPath);
    const [local, upstream] = await Promise.all(
      [localPath, upstreamPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))),
    );
    const dependencies = new Set(local.entries.flatMap(({ uses }) => uses ?? []));
    const references = upstream.entries
      .filter(({ id }) => dependencies.has(id))
      .map(({ id, name, category, description, useWhen, uses, links }) => ({
        id,
        name,
        category,
        description,
        useWhen,
        uses,
        documentation: links.documentation,
      }));
    return `export default ${JSON.stringify(references)};`;
  },
};

export default defineConfig({
  plugins: [
    catalogReferences,
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
