# Shared core and local service

Glassbox v2 uses a database-free local service. The Rust workspace follows
Hot Sheet 2's model and service split. The transport-neutral model can be
used by the service, Tauri, and future native clients. The web client reads
the same versioned JSON contract.

Run `cargo run -p glassbox-server` to launch the service. It binds an
OS-assigned port on IPv4 loopback and prints the resolved socket address on
stdout once bound. `GET /api/v1/health` returns HTTP 200 with
`{"api_version":1,"status":"ready"}`. The readiness response contains no
project or review data. See [Web and Tauri host](hosting.md) for launch, lifecycle and origin rules.

## Glassbox v1 parity map

| Area                                   | v1 reference                                                              | v2 plan                                                                                                                                                                                                                                                              |
| -------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git changes and arbitrary comparisons  | `src/git/`, `src/review-open/`, `docs/18-direct-comparison.md`            | Port behavior and fixtures with `HS2-G9TCM1`, `HS2-2DDNCY` and `HS2-B7QRKJ`.                                                                                                                                                                                         |
| CLI                                    | `src/cli-difftool.ts`, `src/difftool/`, `docs/19-difftool-integration.md` | Simplify to `glassbox-cli` and Git difftool in `HS2-TSQ44F`.                                                                                                                                                                                                         |
| Reviews and feedback                   | `src/review-notes/`, `src/attachments/`, `src/export/`                    | Carry forward categorized and region feedback, AI notes and threads. Replace database-backed review history and completion with editable file bundles and a choice of Hot Sheet delivery or copied AI instruction. See `HS2-DSFN2E`, `HS2-2E618Q`, and `HS2-AJZ2J3`. |
| Settings and storage                   | `src/global-config.ts`, `src/project-settings-store.ts`, `src/db/`        | Keep settings and review bundles in files. Scope cleanup in `HS2-D518Y2`. PostgreSQL and persisted review completion are retired.                                                                                                                                    |
| AI and content plugins                 | `src/ai/`, `src/plugins/`, `docs/22-local-and-on-device-models.md`        | Carry forward risk scoring and guidance via a Hot Sheet 2-style provider contract. Provider coverage, cache policy, and content renderer parity are tracked in `HS2-QHTFTW`, `HS2-JZ6M27`, and `HS2-B7QRKJ`.                                                         |
| Web and desktop                        | `src/client/`, `src-tauri/`, `docs/10-desktop-app.md`                     | Web and Tauri ship first. Native clients are deferred. Distribution follows Hot Sheet 2 in `HS2-QJCQHF`.                                                                                                                                                             |
| Appearance and image baseline workflow | `src/themes/`, `src/ground-truth/`                                        | Ship Light and Dark with system default. Ground-truth image comparison is retired. Ordinary image comparisons remain in scope.                                                                                                                                       |
