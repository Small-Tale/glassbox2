# Symbol navigation

The shared host resolves Rust, TypeScript, JavaScript, and Python declarations
for the selected side of a Git review (`HS2-PKF3GE`, `HS2-8BVWYT`).
JavaScript and TypeScript share a search family, including JSX, TSX, and the
ES module and CommonJS extensions. Python searches functions, methods, and
classes in source and stub files. Syntax trees identify declarations
without matching apparent declarations inside comments or strings. Lookup
prefers a unique definition in the current file, then in changed files, then
in tracked files outside the diff. Multiple matches in a tier are ambiguous.
This is a declaration search by name. Language-server binding and external
package resolution are outside this lookup.

`POST /api/v1/review/definition` accepts the selected file, its displayed
diff revision, an explicit before or after side, and a symbol name. A stale
selection or revision returns HTTP 409. A found result includes the destination
path, one-based line, side, exact source text, its SHA-256 content revision,
and the changed-file index and diff revision when available. Git commit comparisons read
resolved commit trees, staged comparisons read the index, and working-tree
sides read bounded regular files within the checkout. The resolver limits
supported source files to 256 KiB and searches up to 64 candidates per tier
after the current file.

In a supported Git text comparison, hold Command on macOS or Control on
Windows and Linux, then click a symbol. Side by Side uses the clicked side.
Inline uses the after side for shared lines and the before side for removals.
Glassbox highlights the declaration in the corresponding diff when it has
the matching revision and line. Otherwise it shows a read-only source
excerpt on the resolved side. Use the existing back and forward buttons
or keyboard shortcuts to revisit either view and its scroll position.

AI discussions can link to source on the note's Git side (`HS2-VES1BF`).
An observation can include numbered references such as `[initialization](0)`
with a matching `related_locations` entry containing a repository-relative
path and one-based line. Glassbox resolves valid tracked text locations and
saves their content revisions with the note. Unusable references remain
literal text and preserve their array positions. The host checks both the
note's diff revision and the destination's content revision before opening a
link. Changed-file locations use the diff when the matching line is visible.
Other locations open read-only source. Both use the same back and forward
history as a definition lookup.

The benchmark fixtures from `HS2-HQCQXH` compare exact name and line
against hand-labeled TypeScript and Rust declarations. Unit tests reuse
those fixtures. The host parser matched all 11 TypeScript and 9 Rust
locations and found no definition for the phantom symbol in either fixture.
A real repository and loopback host exercise worktree,
index, commit, changed and unchanged destinations, stale requests, and
ambiguity. The real workbench test covers the shortcut, both destination
views, and back and forward history (`HS2-HQCQXH`).
