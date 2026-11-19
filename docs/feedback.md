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
