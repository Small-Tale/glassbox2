# Symbol navigation

The shared host resolves Rust and TypeScript declarations for the selected
side of a Git review (`HS2-PKF3GE`). Syntax trees identify declarations
without matching apparent declarations inside comments or strings. Lookup
prefers a unique definition in the current file, then in changed files, then
in tracked files outside the diff. Multiple matches in a tier are ambiguous.
This is a declaration search by name. Language-server binding and external
package resolution are outside this lookup.

`POST /api/v1/review/definition` accepts the selected file, its displayed
diff revision, an explicit before or after side, and a symbol name. A stale
selection or revision returns HTTP 409. A found result includes the destination
path, one-based line, side, exact source text, its SHA-256 content revision,
and the changed-file index when available. Git commit comparisons read
resolved commit trees, staged comparisons read the index, and working-tree
sides read bounded regular files within the checkout. The resolver limits
supported source files to 256 KiB and searches up to 64 candidates per tier
after the current file.

The benchmark fixtures from `HS2-HQCQXH` compare exact name and line
against hand-labeled TypeScript and Rust declarations. Unit tests reuse
those fixtures. The host parser matched all 11 TypeScript and 9 Rust
locations and found no definition for the phantom symbol in either fixture.
A real repository and loopback host exercise worktree,
index, commit, changed and unchanged destinations, stale requests, and
ambiguity. The workbench shortcut, preview, and navigation history
integration are tracked in `HS2-HQCQXH`.
