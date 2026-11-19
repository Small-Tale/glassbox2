# UI conventions

Glassbox follows the installed Kerf [interaction conventions](../node_modules/@kerfjs/ui/docs/interaction-conventions.md)
and [catalog authoring contract](../node_modules/@kerfjs/ui/docs/catalog.md#catalog-demo-authoring-contract).

## Components and catalog

Keep related Glassbox components under `src/components/<group>/` with their
owned styles. Register each custom component in `kerf.components.json`, run
`npm run catalog:generate`, and add a specimen under
`src/ux-demo/demos/<group>/`. Wire the specimen in `src/ux-demo/catalog.ts`
and use the same component in the application. Group specimens by function and
use Kerf's `CatalogExample` for each meaningful variant or state.

Both builds and the dev server expose the catalog at `/ux-demo/`. Run
`npm run check` to verify catalog metadata, lint, types, Kerf UI Doctor, tests,
and the build. Inspect wide, medium, and compact browser layouts where UI changes.
