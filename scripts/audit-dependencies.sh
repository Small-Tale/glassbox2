#!/usr/bin/env bash
# Dependency advisory gate for the three lockfiles Glassbox ships (HS2-0N4NPR); policy: docs/dependency-audit.md.
# Fails on a vulnerability in the web npm lockfile (production dependencies at moderate or above, development
# dependencies at high or above), the workspace Cargo.lock, or the desktop shell's Cargo.lock, except advisories
# listed with a ticket and an expiry in the matching audit.toml. Unmaintained or unsound crates are reported only.
set -euo pipefail
cd "$(dirname "$0")/.."

status=0
run() {
  echo "== $1"
  shift
  if ! "$@"; then status=1; fi
}

run "web npm lockfile, production dependencies" npm audit --prefix clients/web --omit=dev --audit-level=moderate
run "web npm lockfile, development dependencies" npm audit --prefix clients/web --audit-level=high
# cargo-audit reads .cargo/audit.toml from the directory it runs in, so each lockfile is audited from its own.
run "workspace Cargo.lock" cargo audit
run "desktop shell Cargo.lock" bash -c 'cd clients/web/src-tauri && cargo audit'

exit "$status"
