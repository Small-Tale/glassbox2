# Web and Tauri host

For the browser client, run `npm ci`, `npm run build`, then
`cargo run -p glassbox-server -- --assets dist`. Open the loopback address
printed by the service. The same origin serves the app, `/ux-demo/`, the
versioned readiness response, and read-only application settings.

For a local Tauri smoke run, build the frontend first, then run
`cargo run --manifest-path src-tauri/Cargo.toml --locked`. The desktop shell
opens a native window on the same loopback service, which it owns as an
in-process task. Debug builds use `dist/`. Packaged builds load the bundled
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
