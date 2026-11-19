# Glassbox v2

This checkout contains the Kerf scaffold for the Glassbox v2 design pass
(`HS2-8QJ9NY`). The app entry point and demo are generated starting points for
the mock environment.

Run `npm ci` to install the pinned tooling and `npm run check` to verify it.
Run `npm run dev` and open `/ux-demo/` for the Glassbox component catalog.
See the [UI conventions](docs/ui-conventions.md) for adding components and demos. The design-mock skill is installed at
`node_modules/@kerfjs/ui/ai/design-mock/SKILL.md`. The template index is
`node_modules/@kerfjs/ui/docs/design/templates.md`.

## Web coding conventions

Use the Hot Sheet 2 web client as the reference for Glassbox TypeScript and Kerf
code. Run `npm run lint` and `npm run typecheck` locally. Use strict typed ESLint,
sorted imports with type-only imports where applicable, Prettier for formatting,
and Kerf's composition rules. Use public Kerf controls, Lucide icons, accessible
names for icon-only actions, and the Workbench's responsive toolbar layout.
