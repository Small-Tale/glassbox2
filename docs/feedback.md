# Review feedback

A review can have multiple independent threads at the same diff line
or image region. The opening item identifies its author and origin.
Reviewer threads use the Glassbox v1 categories Bug, Fix, Style,
Pattern Follow, Pattern Avoid, Note, and Remember. AI threads carry
their own tags and optional risk level. Both kinds accept ordered
replies with independent authors and attachments.

| Category       | Meaning in the feedback handoff                  |
| -------------- | ------------------------------------------------ |
| Bug            | Correct a code defect.                           |
| Fix            | Apply a specific correction.                     |
| Style          | Apply a stylistic preference.                    |
| Pattern Follow | Continue a useful pattern in new code.           |
| Pattern Avoid  | Refactor an anti-pattern and avoid repeating it. |
| Note           | Consider context that may require no change.     |
| Remember       | Record a durable rule or preference.             |

A thread anchor records the source-relative path, comparison side,
and side-specific revision. Line ranges are one-based and inclusive.
Image coordinates use fractions from 0 to 1 relative to the
untransformed image. If the marked revision changes or disappears,
the anchor is stale. Rebinding an anchor is an explicit edit.

Edits, moves, replies, attachment operations, and removals require
the thread's current revision. A conflict leaves the saved thread
intact. IDs are unique and stable within a review, including after
deletions and document round trips. Deleting a thread or reply
removes its attached records from that document.

Attachments accept any file content up to 50 MB. The contract
accepts a filename and the bytes, with no filesystem path input.
The writer uses an attachment ID for storage paths. The bundle
writer is tracked in `HS2-2E618Q` and the thread inspector in
`HS2-XQBQCG`.

The model tests verify validation and full mutation sequences,
including mixed threads on one line, stale anchors, conflicting
edits, scoped attachments, and JSON recovery.

## Durable AI handoff

The feedback bundle store creates a private directory for each review
under `.glassbox2/feedback` in the current user's home directory
(`HS2-2E618Q`). A bundle is readable immediately and remains available
after app exit. Its stable `review.md` path is the target of the copied
AI instruction. The instruction quotes the absolute path as a JSON
string and refers to attachment paths relative to that document.

The Markdown includes project and comparison context, source anchors,
authorship, categories, AI tags and risk, messages, and replies.
Attachments are real files with content-addressed names and portable
extensions. Publication writes evidence before replacing the Markdown
atomically. A failed publication leaves the previous Markdown and
its referenced evidence available. Publishing again updates the same
path. Storage management is tracked in `HS2-D518Y2`.

Disk tests cover copied instructions, edits after handoff, binary
evidence, failed publication and retry, and concurrent reading.

## Hot Sheet 2 delivery

Glassbox uses the local `hotsheet-cli` and the selected project's
Hot Sheet 2 store (`HS2-AJZ2J3`). Project discovery follows UX Review's
store override, linked store, and sibling store lookup. An explicitly
selected store is scoped to that destination for every command.

New Ticket is the default. Existing Ticket appends to the selected
ticket and keeps its current status. Each deliberate delivery freezes
the current feedback and its referenced evidence in one attachment
batch. The Markdown refers to files by their Hot Sheet attachment names.
Optional reviewer summary text is included in the delivery note.

Retrying the same prepared delivery reconciles the ticket, batch files,
and note before writing. It preserves a partial batch and skips files and
the note already recorded for that delivery. Starting another delivery
uses the latest bundle and a separate batch. The export controls are
tracked in `HS2-6DE0XA`.

The isolated real-store check can run with
`cargo test -p glassbox-feedback real_hotsheet -- --ignored` when a
current Hot Sheet 2 CLI is installed.

## Feedback storage

Glassbox measures bundle counts and logical file bytes per project
and across the local store (`HS2-D518Y2`). Reports include evidence,
unassigned bundles, and open reviews. Existing project paths are
grouped by their canonical location.

First-release retention is manual. A 30-day expiry would make saved
instructions stop working as they aged. Explicit cleanup can clear one
project or the entire store. Cleanup skips open bundles, including a
bundle being edited by another Glassbox process. Each removed bundle
releases its Markdown and evidence, and copied instructions for it stop
resolving. Cleanup can resume after an individual removal error.

A filesystem lease protects each live bundle and is released when the
writer exits. Only directories identified as Glassbox bundles are
eligible for cleanup. The settings controls and confirmation are
tracked in `HS2-5TN81D`.
