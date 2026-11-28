# Codebase map

- `crates/glassbox-cli` runs Git difftool and forwards its two paths to the selected Glassbox client. `src/register.rs` registers and unregisters the default Git difftool through `git config`, and `src/group.rs` stages the per-file launches of one plain `git difftool` run so the last one opens a single review (`GB2-FXJSSM`).
- `scripts/audit-dependencies.sh`, `.github/workflows/audit.yml` and the two `audit.toml` files are the dependency advisory gate (`docs/dependency-audit.md`, `HS2-0N4NPR`).
- `crates/glassbox-server/src/symbols.rs` also validates cited commits and serves `POST /api/v1/review/commit-location`; `clients/web/src/components/review/review-link.ts` builds and parses the deep link that opens one in a new tab (`HS2-B5K6GM`).
- `crates/glassbox-server/src/attachments.rs` verifies attachment types and serves the preview and open endpoints (`HS2-3G613V`).
- `crates/glassbox-feedback` publishes the durable Markdown handoff and its attachments, the public JSON export (`src/export.rs`, documented in `docs/feedback-export.md`), manages editable snapshots and storage leases, and delivers feedback to Hot Sheet.
- `crates/glassbox-model` owns client-neutral types, the readiness wire shape, and the versioned feedback model under `src/feedback`.
- `crates/glassbox-server/src/symbols.rs` resolves definitions, AI note source destinations and the per-file symbol outline (`POST /api/v1/review/outline`, client `components/review/symbol-outline*.ts*`) from bounded Git-side source. `discussion.rs` verifies the note's stored link before opening it.
- `crates/glassbox-ai` owns [provider discovery and the subprocess protocol](../ai-providers.md), plus the local HTTP adapter. The Apple adapter lives in `plugins/ai/apple-foundation`.
- `crates/glassbox-server/src/renderers.rs` reports renderer readiness for the Diagram Renderers dialog (`clients/web/src/components/settings/renderer-dialog.tsx`).
- `crates/glassbox-render-local` provides the optional Graphviz, Mermaid, and PlantUML subprocess adapter.
- `crates/glassbox-server` owns the shared loopback HTTP host, frontend hosting, review source endpoints, optional diagram rendering and analysis jobs, and real-process tests.
- `clients/web/src-tauri` owns the native window and embedded host lifecycle.
- `crates/glassbox-settings` owns versioned per-user JSON settings and atomic file replacement.
- `crates/glassbox-comparison` owns Git and direct path comparisons, selected-file text/media data, and real-repository and filesystem fixtures.
- `clients/web/src/app` contains the web app entry point. `clients/web/src/components` groups shared Kerf components by feature.
- `clients/web/src/components/diff/context-expansion.ts` holds the pure unchanged-line model and fetch state, `context-expander.tsx` the controls; `diff-find.ts` holds the Find model and `diff-find-controls.tsx` its toolbar field and wiring; `crates/glassbox-server/src/review_files.rs` serves `POST /api/v1/review/context`.
- `crates/glassbox-server/src/progress.rs` serves review progress; marks persist through `glassbox-settings` (`load_reviewed`, `set_reviewed`). The web state is `clients/web/src/components/review/review-progress.ts`.
- `crates/glassbox-server/src/discussion.rs` also validates thread moves and answers `POST /api/v1/review/discussion/relocate`; `ReviewAnchor.quote` in `glassbox-model` records the anchored line's text.
- `clients/web/src/ux-demo` hosts the catalog at `/ux-demo/`. `kerf.components.json` generates the selection and composition catalogs.
- `clients/web/demo-capture` is the deterministic demo capture harness (`scene.mjs` format, `scenes.mjs`, `host.mjs`, `capture.mjs`, `run.mjs`); see [demo capture](../demo-capture.md). `npm run demo:capture` runs it.
- `clients/web/demo-capture/archive.mjs` records versioned comparison artifacts and verifies their digests. `compare.mjs` reports version differences and `coverage.mjs` lists component and flow gaps (`HS2-5TFS63`).
- `clients/web/src/design-mock` contains the approved design fixture for local development.
- Rust gates are `cargo fmt --all --check`, `cargo clippy --locked --workspace --all-targets -- -D warnings` and `cargo test --locked --workspace --quiet`.
- Web gates are `npm --prefix clients/web run check`, including formatting, ESLint, typecheck, metadata, Kerf Doctor, structure tests and build. The GitHub workflow runs both gate sets on macOS and Linux. See the [macOS and Linux verification record](../release-verification.md) for feature coverage and installed-package checks.

- CI runs the shared Rust gate and built-client Tauri startup checks on Ubuntu, macOS, and Windows. See [platform checks](../hosting.md#first-release-platform-checks).
