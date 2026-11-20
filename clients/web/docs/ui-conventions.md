# UI conventions

Glassbox follows the installed Kerf [interaction conventions](../node_modules/@kerfjs/ui/docs/interaction-conventions.md)
and [catalog authoring contract](../node_modules/@kerfjs/ui/docs/catalog.md#catalog-demo-authoring-contract).

## Components and catalog

Run client commands from `clients/web`. Keep related Glassbox components under `src/components/<group>/` with their
owned styles. Register each custom component in `kerf.components.json`, run
`npm run catalog:generate`, and add a specimen under
`src/ux-demo/demos/<group>/`. Wire the specimen in `src/ux-demo/catalog.ts`
and use the same component in the application. Group specimens by function and
use Kerf's `CatalogExample` for each meaningful variant or state.

Open `/ux-demo` directly for developer review in Vite or the built client. Run
`npm run check` to verify catalog metadata, lint, types, Kerf UI Doctor, tests,
and the build. Inspect wide, medium, and compact browser layouts where UI changes.

## Review workbench

The browser and Tauri app share the Review Workbench composition
(`HS2-28VEG4`). The project and file navigator use the left rail, and a
single contextual inspector uses the right rail. The comparison owns the
central toolbar and footer. The browser and window title identify Glassbox.

The inspector becomes an overlay below 1080px of workbench width. The
file navigator becomes an overlay below 730px. Inline panels can be
resized by drag or keyboard. The same rail actions restore collapsed
panels, and overlay panels dismiss with Escape or an outside click.
The catalog's Review Workbench entry shows the shared composition with
a sample source context.

## Review source and changed files

The left rail accepts a Git repository or a pair of files or folders
(`HS2-KGVXT8`). With a review open, Change Source retains the active files
until the next source loads. The navigator shows the source context,
path hierarchy, file statuses, and a path filter. Keyboard navigation
follows Kerf Tree List. Selection drives the central filename heading.

## Text diff toolbar

Side by Side and Inline share one normal-size Lucide toolbar group.
Wrap has its own group and keeps its state when switching layouts or
resizing (`HS2-RVP90A`). Both layouts annotate their before and after
line numbers for downstream review threads.

## Appearance

The center footer has one icon-only Appearance menu with System,
Light, and Dark choices. Its selected state reflects the shared
setting (`HS2-9T7RCB`).

The developer catalog exposes Kerf's theme, contrast, motion, and preview
background controls. The footer lists related Glassbox entries and links to
the specimen, component source, and UI guidance. The `component` query
parameter links directly to a specimen (`HS2-D2T8BN`).
