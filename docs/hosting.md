# Web and Tauri host

For the browser client, run `npm --prefix clients/web ci`,
`npm --prefix clients/web run build`, then
`cargo run -p glassbox-server -- --assets clients/web/dist`. Open the loopback address
printed by the service. The same origin serves the app, the developer catalog at `/ux-demo`, the
versioned readiness response, and read/write application settings.

For a local Tauri smoke run, build the frontend first, then run
`cargo run --manifest-path clients/web/src-tauri/Cargo.toml --locked`. The desktop shell
opens a native window on the same loopback service, which it owns as an
in-process task. Debug builds use `clients/web/dist/`. Packaged builds load the bundled
web assets. The window is scoped to the local service origin and does not use
a separate native transport for review data. Closing the native application
ends the embedded task.

The host binds IPv4 loopback on a port chosen by the OS. It accepts the bound
Host value and rejects requests with a foreign Origin or cross-site API
fetch metadata. Client contracts remain independent of the webview implementation.

The clients load changed-file metadata from `POST /api/v1/review/files`.
The source can be a repository with a Git mode, a direct path pair, or
the host's difftool launch. The response includes the source identity,
branch when available, paths, and change statuses. Difftool lookup uses
the inputs held by the host for the lifetime of that launch.

## First-release platform checks

The CI workflow runs the complete shared Rust test and Clippy gates on
macOS, Linux, and Windows. These cover Git and difftool launches, direct
paths, feedback and attachment round trips, retention and cleanup, and
provider job contracts. The native job on each platform builds the web
assets and tests the Tauri entry point’s own loopback startup with real
difftool arguments. It verifies the built index page, readiness, and the
decoded launch inputs. Linux native builds use the distribution
dependencies listed in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

To run the same native check from a checkout:

```sh
npm --prefix clients/web ci
npm --prefix clients/web run build
cargo test --locked --manifest-path clients/web/src-tauri/Cargo.toml
```

With a local Hot Sheet 2 CLI, the following tests use isolated stores and
exercise delivery to new and existing tickets and replay after a partial
send:

```sh
cargo test --locked -p glassbox-server export_sends_to_a_new_and_an_existing_ticket_without_replaying_delivery -- --ignored
cargo test --locked -p glassbox-feedback real_hotsheet -- --ignored
```

The shared gates use a deterministic provider fixture. A real local model
smoke test can also be run using the [provider verification
instructions](ai-providers.md#verification). GUI review in all three
webviews, native open and reveal, and installed distribution artifacts are
tracked in `HS2-FFVSW0`, `HS2-PZWXXF`, and `HS2-QJCQHF`.
