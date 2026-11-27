# Dependency advisory gate (`HS2-0N4NPR`)

Glassbox 2 ships from three lockfiles, and each is checked against published security advisories before a release
and whenever it changes. Glassbox v1 gated releases the same way (`GB-813`, `GB-1119`, `GB-1191`); this gate is
separate from any npm distribution mechanism (`HS2-QJCQHF`).

| Lockfile                           | What it ships                      | Tool                    |
| ---------------------------------- | ---------------------------------- | ----------------------- |
| `clients/web/package-lock.json`    | The web client and its build       | `npm audit`             |
| `Cargo.lock`                       | The shared host, CLI and libraries | `cargo audit` (RustSec) |
| `clients/web/src-tauri/Cargo.lock` | The desktop shell                  | `cargo audit` (RustSec) |

## Policy

- **Fails the gate:** a vulnerability in a production npm dependency at moderate severity or above, in a development
  npm dependency at high severity or above, or any RustSec vulnerability in either Rust lockfile.
- **Reported, does not fail:** unmaintained or unsound crates (RustSec warnings). They are read at each release and
  tracked when one has a fix path.
- **Exceptions** live in the matching `audit.toml` (`.cargo/audit.toml` and `clients/web/src-tauri/.cargo/audit.toml`),
  one advisory per line as `"RUSTSEC-YYYY-NNNN", # TICKET: why it does not apply; expires YYYY-MM-DD`. A policy test
  fails when an exception lacks a ticket, a reason or a future expiry, so an exception is a dated decision, not a
  silent suppression.
- **Fix first.** Update the crate (`cargo update -p <crate> --precise <patched>`); raise a declared `rust-version`
  when the patched crate needs a newer compiler (the desktop shell now declares 1.88 for `time` 0.3.47).

## Running it

`scripts/audit-dependencies.sh` runs all four checks and exits non-zero on a violation; it needs `cargo-audit`
(`cargo install cargo-audit --locked`) and network access for the advisory databases. The `Dependency audit` workflow
(`.github/workflows/audit.yml`) runs it on every change to a lockfile, an audit policy or the script, and every Monday,
because new advisories appear without any change here. The release readiness gate (`HS2-KPFXGC`) requires the latest
run on the release commit to be green.

## State on 2026-11-27

| Lockfile                             | Result                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web npm (production and development) | 0 vulnerabilities                                                                                                                                                                                                                                                                     |
| `Cargo.lock`                         | 0 vulnerabilities after `url` 2.5.9 (`RUSTSEC-2026-0592`); 1 warning (`unsafe-libyaml`, unmaintained, via `serde_yaml`)                                                                                                                                                               |
| `src-tauri/Cargo.lock`               | `url`, `time` and `cookie` updated to patched versions; 2 reviewed exceptions for `quick-xml` (`RUSTSEC-2026-0194`, `RUSTSEC-2026-0195`); 9 warnings (unmaintained `chrono`, `proc-macro-error`, `unic-*`, `unsafe-libyaml`, and unsound `glib` through Tauri's Linux GTK 3 bindings) |

The two `quick-xml` exceptions: it is reached only through `plist`, which reads the application's own bundle
metadata, no released `plist` uses a patched `quick-xml`, and the advisories are denial of service on crafted XML.
They expire on 2026-12-27 so they are reviewed against newer `plist` and Tauri releases.
