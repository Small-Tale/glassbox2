# Codebase map

- `crates/glassbox-model` owns client-neutral types and the readiness wire shape.
- `crates/glassbox-server` owns the Axum entry point and the real-process HTTP test.
- `crates/glassbox-settings` owns versioned per-user JSON settings and atomic file replacement.
- `crates/glassbox-comparison` owns Git and direct path comparisons, selected-file text/media data, and real-repository and filesystem fixtures.
- `src/app` contains the web app entry point. `src/components` groups shared Kerf components by feature.
- `src/ux-demo` hosts the catalog at `/ux-demo/`. `kerf.components.json` generates the selection and composition catalogs.
- `src/design-mock` contains the approved design fixture for local development.
- Rust gates are `cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings` and `cargo test --locked --workspace --quiet`.
- Web gates are `npm run check`, including formatting, ESLint, typecheck, metadata, Kerf Doctor, structure tests and build. The GitHub workflow runs both gate sets.
