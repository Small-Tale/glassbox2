# Codebase map

- `crates/glassbox-cli` runs Git difftool and forwards its two paths to the selected Glassbox client.
- `crates/glassbox-feedback` publishes the durable Markdown handoff, its attachments, Hot Sheet delivery, and feedback storage operations.
- `crates/glassbox-model` owns client-neutral types, the readiness wire shape, and the versioned feedback model under `src/feedback`.
- `crates/glassbox-ai` owns [provider discovery and the subprocess protocol](../ai-providers.md), plus the local HTTP adapter. The Apple adapter lives in `plugins/ai/apple-foundation`.
- `crates/glassbox-render-local` provides the optional Graphviz, Mermaid, and PlantUML subprocess adapter.
- `crates/glassbox-server` owns the shared loopback HTTP host, frontend hosting, review source endpoints, optional diagram rendering and analysis jobs, and real-process tests.
- `clients/web/src-tauri` owns the native window and embedded host lifecycle.
- `crates/glassbox-settings` owns versioned per-user JSON settings and atomic file replacement.
- `crates/glassbox-comparison` owns Git and direct path comparisons, selected-file text/media data, and real-repository and filesystem fixtures.
- `clients/web/src/app` contains the web app entry point. `clients/web/src/components` groups shared Kerf components by feature.
- `clients/web/src/ux-demo` hosts the catalog at `/ux-demo/`. `kerf.components.json` generates the selection and composition catalogs.
- `clients/web/src/design-mock` contains the approved design fixture for local development.
- Rust gates are `cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings` and `cargo test --locked --workspace --quiet`.
- Web gates are `npm --prefix clients/web run check`, including formatting, ESLint, typecheck, metadata, Kerf Doctor, structure tests and build. The GitHub workflow runs both gate sets.

- CI runs the shared Rust gate and built-client Tauri startup checks on Ubuntu, macOS, and Windows. See [platform checks](../hosting.md#first-release-platform-checks).
