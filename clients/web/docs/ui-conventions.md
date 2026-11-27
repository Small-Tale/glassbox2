# UI conventions

Glassbox follows the installed Kerf [interaction conventions](../node_modules/@kerfjs/ui/docs/interaction-conventions.md)
and [catalog authoring contract](../node_modules/@kerfjs/ui/docs/catalog.md#catalog-demo-authoring-contract).
The [Kerf consumer fitness audit](https://github.com/brianwestphal/kerf/blob/main/docs/kerf-consumer-fitness-audit.md#glassbox-2-adoption)
tracks the upstream gaps and Glassbox adoption work against a dated source snapshot.

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

## Text and status copy

Plain text in application components uses Kerf `Text` instead of native `p`, `span` and `strong`, and inline error
feedback uses `StateBanner` (`GB2-BJTE39`). The source context, analysis context and review navigator are converted.
`SourceContext` keeps a bare root element only because the catalog metadata requires a root class; it has no
stylesheet. The analysis context strip keeps its own tinted background and wrapping layout (application-owned structure
until a Kerf strip fits it). The discussion inspector converts too: inline threads are `ContentItem` toggles inside a `wireContentItems` root, replies
are framed `ContentItem`s, action groups are `Row`s and statuses are `Text`. `discussion.css` keeps only the inline
thread band (it places itself across the diff grid), the inspector's grid and the diagram artifact sizing, which are
application-owned structure. The media diff's region instructions and statuses use `Text` and its slice position is a Kerf `Slider`. Every Share
Feedback and Appearance menu entry has a Lucide icon, and their status copy is `Text`.

Recorded exceptions (`GB2-BJTE39`): the text diff keeps native `div` and `span` cells because the line grid, line
numbers, change markers and syntax tokens are domain rendering with no Kerf equivalent; the media diff keeps its
overlay, viewport and region layers for the same reason; `.review-workbench` is a bare root that gives the Kerf
`Workbench` a definite block size.

## Review workbench

The browser and Tauri app share the Review Workbench composition
(`HS2-28VEG4`). The project and file navigator use the left rail, and a
single contextual inspector uses the right rail. The comparison owns the
central toolbar and footer. The browser and window title identify Glassbox.

The inspector becomes an overlay below 1080px of workbench width. The
file navigator becomes an overlay below 730px. Inline panels can be
resized by drag or keyboard. The same rail actions restore collapsed
panels, and overlay panels dismiss with Escape or an outside click.
Choosing a changed file while the navigator is an overlay closes it so the
selected diff is visible, including when the file is already selected. A
docked navigator stays open (`HS2-Q46BRQ`).
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

The catalog's Contrast control sets Kerf's `data-kui-contrast="more"` on the
document root and the app carries no contrast tokens of its own; the OS
`prefers-contrast` behavior stays active independently (`HS2-T9J9BE`).

Catalog `uses` describes direct dependencies of the production component.
The app supplies the Workbench's slot content. Demo fixture components and
slot content do not create a Workbench dependency. Keep each production
component source represented and declare its required wiring in
`kerf.components.json` (`HS2-R1ZZ67`).

The catalog is one Glassbox package that imports Kerf's own library catalog
(`@kerfjs/ui/catalog-library`) and is composed with `composeCatalog`, so the
Kerf UI and Web Awesome groups, their Uses and Used by menus and the direct
links between Glassbox and library entries come from Kerf rather than an app
projection (`HS2-RBX2HQ`, `HS2-S9EG8B`). The library groups start collapsed
and Web Awesome keeps Kerf's Show Discouraged switch. Entries are addressed
by Kerf's qualified id, for example `?component=@kerfjs/ui:button`; a bare
Glassbox id such as `?component=saved-review-dialog` still opens its entry.

## Discussion

Line actions distinguish before and after anchors. The diff groups previews
beneath the matching line and distinguishes the active thread with a brand
border and quiet fill. The inspector retains the open thread across diff
layout changes and labels stale anchors. See HS2-XQBQCG.

The center footer uses an icon-only Share Feedback action with labeled
choices. Clipboard feedback is announced in the footer. See HS2-0Y326D.

The Hot Sheet delivery dialog groups project, ticket, review summary, and
included feedback. Change and Recent are borderless brand-colored actions.
The delivery and cancel controls stay in the dialog footer. See HS2-6DE0XA.

The Feedback Storage dialog distinguishes usage, the selected deletion
scope, and cleanup results. It keeps destructive actions in the pinned
footer after a separate confirmation. See HS2-5TN81D.

Risk Analysis and Code Guidance use separate normal-size Lucide groups.
Risk highlights the existing note in place. Guidance and progress sit
above the diff. See HS2-487RGX.

## Dialogs and Kerf component use (GB2-FRH9JJ)

The guidance in `node_modules/@kerfjs/ui/llms.txt` and the pages it links is the authority: reuse a Kerf
component, compose primitives, add an application component only for domain behavior, and write CSS only for
an application-owned selector, never to space, size or restyle a Kerf component. These decisions follow from
reading it in full (`interaction-conventions.md`, `component-selection.md` decision pass, `surface-scaffold.md`,
`workbench-dialog.md` and the `Text`, `StateBanner`, `EmptyState`, `ListActionRow`, `ListItem` and `DialogSurface`
pages).

- **Single-pane dialogs use `DialogSurface`**, not `WorkbenchDialog`. `WorkbenchDialog` is for an editing task
  with side panels and draws no body inset, which is why dialogs built on it needed an app margin on the content
  while the footer kept Kerf's own inset: the title, content and footer did not share an edge (`HS2-04T93G`).
  A `DialogSurface` with `bodyInset="none"` and a `List` body gives one edge for header, rows and footer with no
  CSS. Saved Reviews, Feedback Storage, AI Settings and Send to Hot Sheet 2 are all `DialogSurface` dialogs
  (`GB2-FRH9JJ`, `GB2-806ABB`); title, content and footer share one edge in each (`HS2-04T93G`).
- **Rows are rows, text is `Text`, states are components.** A saved review is a `ListActionRow` with a trailing
  overflow `PopupMenu` whose "Delete…" entry has an icon; a row whose only action is the row itself (a storage
  project that opens its cleanup confirmation, Change Project, Load Models) is a `ListItem`, because a lone
  `Button` inside `ListInsetControl` stretches to the full width and centers its label; form fields and checkbox
  groups sit in `ListInsetControl`; a section label is `ListHeader`; absence and loading are
  `EmptyState`; persistent errors and status are `StateBanner`; paragraphs and headings are `Text`. Do not write
  `p`, `h1`..`h6`, `ul` or `section` for UI that one of these owns.
- **A destructive confirmation is an alert `DialogSurface`** (`alert`, `describedBy` the message), Cancel first,
  the danger action last, Cancel with secondary emphasis like the neighboring dialogs.
- **Unchanged-line controls are Kerf `Button`s in a `Row`** (`HS2-DZ8ZR6`): compact, plain, with a chevron icon and a
  title-case label that names the count. Failures are an alert `StateBanner`. Their only application CSS spans the
  grid and returns the interface font inside the diff's monospace face (`context-expander.css`).
- **The Diagram Renderers dialog is a single-pane `DialogSurface`** (`HS2-Q9TXER`) like the other settings dialogs: a
  `StateBanner` for a missing renderer, `ListInsetText` rows per format with the readiness as text, Check Again and Close
  in the footer, and no installation action.
- **Review progress is a Kerf `ProgressBar` and a pressed `ToolbarButton`** (`HS2-FTEQVQ`): "Files Reviewed" with a short "1 of 12"
  value (a longer sentence wraps in the sidebar), a "Mark Reviewed" toggle in the Selected File Actions group, and a `Badge`
  with a check (reviewed) or an alert (changed since reviewed) beside each row's status badge.
- **Find is a collapsible Kerf `SearchField` in a `single` `ToolbarControlGroup`** (`HS2-30ZEFE`), with the count as its
  `resultText` (never beside the field) and Previous and Next in their own icon group. Its group uses
  `sizing="grow"` with a `growBasis` so the expanded field stays on the toolbar's row. Match highlights are the native
  `mark` element with public `--kui-color-warning-*` tokens in `text-diff.css`; Kerf ships no text-highlight primitive (`KF-25NG0X`); remove the rule when it does.
- **Justified application CSS:** `src/components/diff/text-diff.css` sets `grid-auto-rows: min-content` on the
  application-owned `.text-diff__lines` grid because WebKitGTK keeps stale `auto` row heights after a width
  shrink (`HS2-JEM47K`); no Kerf component owns that grid. The image viewer's blend, slice and region rules are
  domain structure Kerf does not provide. Public `--kui-*` tokens in application CSS follow the
  `foundation.css` contract.
- **Justified lint suppression:** `kerfjs/ui-wiring` is disabled in `saved-review-dialog.tsx`,
  `storage-dialog.tsx`, `analysis-settings-dialog.tsx` and `export-dialog.tsx` because the catalog
  marks `wirePinnablePopover` and `wireOverlaySheets` required for the whole `surface-scaffold` entry, although a
  plain modal has no pinned popover or bottom sheet to wire. This is a gap to report to Kerf, not a pattern.
- **Open audit findings** (files not yet aligned): `discussion` uses raw tags and
  72 lines of CSS; `analysis-controls`, `review-navigator`, `source-context`, `text-diff` and `media-diff` use raw
  text tags in places; the Share Feedback and Appearance menu entries have no icons, which the conventions require.
  Each has its own ticket.
