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

When the host creates or moves a line anchor it also records the anchored line's text as
the optional `quote` (`HS2-RV5BD8`). Anchors saved before that have none. An AI note records its line when the analysis is published, provided the file still matches the analyzed content (`GB2-JWB3SZ`).

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

## Inline discussion

In text comparisons, use the comment action on a before or after line.
Inline previews show each thread’s author, category or AI tags, opening
message, and first reply. The Inspector opens the selected thread and
shows the complete reply chain. Reviewer comments autosave after editing.
A reviewer can give their comment a category, remove it, add replies with
an author, or attach local files. Attachment filenames are visible in the
inspector and their bytes are written into the bundle.

The host checks the selected path and text revision before creating a line
anchor. Existing threads on earlier revisions remain available in the
Inspector with a stale indicator. New AI analysis results are tracked in
`HS2-05B1PZ`.

### Attachment previews and Open Externally (`HS2-3G613V`)

The Inspector lists each attachment under its message. The host decides what is safe to show: an attachment is
**verified** only when its filename extension and its leading bytes agree on one of PNG, JPEG, GIF, WebP or PDF and it
is at most 25 MB. Nothing else is previewed or opened, including SVG, HTML, text, archives and executables, and a
renamed file (a PNG named `.jpg`) is not verified. The thread view reports `preview` (`image` or `pdf`) and `openable`
for each attachment so the client never guesses.

| Attachment | What the Inspector shows | Actions |
| --- | --- | --- |
| Verified image | A thumbnail loaded from the host | Enlarge Preview, Shrink Preview, Open Externally |
| Verified PDF | Nothing until Preview PDF is chosen, then an embedded document, or a clear message where the window cannot show PDFs | Preview PDF, Shrink Preview, Open Externally |
| Not verified | The filename and "Preview unavailable for this file type." | None |
| Diagram source | The existing diagram preview | Preview and Close |
| Preview the host no longer has | "This attachment could not be previewed." | None |

Previews come from `POST /api/v1/review/discussion/attachment`, which returns the verified bytes with the detected
media type, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox` and `Cache-Control: no-store`. An
unverified or oversized attachment answers 415 and a missing one 404. The client turns the response into a blob URL for
the open thread only and releases it when the thread closes or changes.

Open Externally is always an explicit action. `POST /api/v1/review/discussion/attachment/open` writes the verified
bytes to a private temporary copy (directory mode 0700, file mode 0600 on Unix) under a generated name such as
`attachment-12.png`, so the person's filename never reaches the launcher, and starts the platform's default program
the way the file actions do. The copy stays in the temporary directory until the system clears it.
`GLASSBOX_ATTACHMENT_OPENER` replaces the platform opener with a program that receives the path, which the host and
browser tests use to record a launch. Drag and paste are not part of this scope.

### Suggest New Line (`HS2-RV5BD8`)

A stale line comment offers Suggest New Line. The host looks for the line the comment was
made on, by its recorded text, on the same side of the file as it is now. It offers a new
place only when exactly one line reads the same and the diff shows that line, so you can see where it lands:

| Outcome | What the Inspector says | What happens |
| --- | --- | --- |
| One shown match | "The commented text is now at After line 5." with Dismiss and Move Here | Nothing changes until you choose Move Here. |
| More than one match | "More than one line matches the commented text…" | The comment stays stale; nothing is guessed. |
| No match (the line was reworded or removed) | "No line matches the commented text…" | The comment stays stale. |
| A match only in unchanged lines the diff hides | "The only match is in unchanged lines the diff does not show…" | The comment stays stale; reveal the lines and move it yourself. |
| No recorded text (older comments, AI notes published for a file that had already changed) | "This comment did not record its text…" | The comment stays stale. |

Matching is exact, so a changed line is never matched by similarity. Move Here is the
validated Move below, guarded by the suggested text: if the file changed again before you
confirmed, the host answers 409, the comment stays where it was and you can ask again.

### Move Comment (`HS2-TGAGQ4`)

Choose Move Comment in the Inspector to rebind a line thread to another line or
side of the same file. The form takes a side and a line number, and Enter, or
the Move button, saves it; Cancel or Escape closes it without changing anything.
The thread keeps its ID, replies and attachments. Both reviewer comments and AI
notes can move. An image-region thread moves and resizes with Edit Region (see
[Region comments](comparison-content.md#region-comments-hs2-9mz32m)); a line thread cannot become a region.

The host validates the destination as it does when creating a comment: the
line must exist on that side of the file, in the revision you are looking
at, so a line past the end, a file that changed since it opened, or a range
answers 409 and the thread stays where it was. The form stays open
with the reason so you can pick another line. A thread edited elsewhere since
you opened it conflicts rather than being overwritten. Moving a stale thread to
a line of the current revision rebinds it.
Unchanged lines, whether or not the diff shows them, are valid destinations (`GB2-5QQPPW`).

The open comparison retains its editable discussions as files are switched.
Each successful change publishes the current review to its stable local
handoff bundle, which survives the Glassbox process. New bundle publications
include a versioned editable snapshot with the thread IDs, revisions, anchors,
messages, and attachments (`HS2-NG98A2`). The Markdown replacement commits
the associated snapshot. The store can reopen that snapshot with the
same writer lease and Markdown path. Earlier bundles retain their
Markdown handoff.

Open the comparison and choose **Share Feedback → Saved Reviews** to reopen
one of its saved discussions (`HS2-KXCFZF`). Git matching uses the repository
and comparison mode with its requested revisions. Direct comparison matching
uses the ordered input paths. A saved review can be opened when the comparison
has no active feedback bundle. The dialog also lists active discussions whose
files have left the changed-file list. Choose a path to read or edit its stale
threads in the Inspector. Cleanup removes the editable snapshot and its
Markdown together, and skips a reopened bundle while it is active.

Open a saved review's overflow menu and choose **Delete…** to remove just that review
(`HS2-42A696`). An alert dialog first asks for confirmation (Cancel keeps it), then
`POST /api/v1/review/saved/delete` removes the exact owned bundle: the
review must belong to the current comparison and hold a committed snapshot, so
another comparison's review or an unknown or malformed ID is refused (404 or
400). A review open in any Glassbox process is refused with 409 and a message,
and the dialog offers no Delete while this comparison has an open review. Other
saved reviews, their attachments and the active comparison are untouched. The
host requires `confirmed: true`, and the dialog stays on the confirmation with
the host's message when a delete fails, so it can be retried.

Filesystem tests exercise snapshot recovery and cleanup protection. The real
loopback test restores direct-comparison threads, replies, attachments, and
the existing instruction after a restart. The built workbench test restores a
Git review, then opens and edits a stale discussion as the viewport changes. A
second built workbench test cancels and confirms a single-review delete across
viewport widths. Store, loopback HTTP and client state tests cover
confirmation, ownership, an open review, repeats and retry.

## Durable AI handoff

Each bundle also holds `feedback.json`, a documented, versioned JSON form of the same review for
tools that read it programmatically; see [Feedback JSON export](feedback-export.md) (`HS2-A07MHD`).

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
atomically. Windows retries temporary sharing failures for up to half a
second when an external reader has the document open. A failed
publication leaves the previous Markdown and its referenced evidence
available. Publishing again updates the same path. Storage management
is tracked in `HS2-D518Y2`.

Disk tests cover copied instructions, edits after handoff, binary
evidence, failed publication and retry, and concurrent reading.

The center footer’s Share Feedback menu exposes Copy AI Instruction as
soon as a comparison is open. The first copy publishes a bundle even
when the review has no comments. Subsequent copies and edits use the
same bundle path and leave the comparison available for editing. Choose Send to Hot Sheet 2 from the same menu to open the delivery dialog.

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

The dialog previews the whole review by default. Select Threads lets the
reviewer choose complete threads grouped by file. A selected thread
includes its opening comment, replies, and referenced attachments. The
counts reflect the selection. A selected delivery requires at least one
thread and validates its revisions before staging. The local review and
copied AI instruction still include every thread.

The dialog detects the destination from the current comparison
when possible. Change accepts a project or store path. Recent lists
newest-created tickets in the selected store. The existing ticket field
also accepts a pasted Hot Sheet reference. The review remains available
after delivery.

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
grouped by their canonical location and shown in their ordinary form, so
Windows lists `C:\Users\me\project`, not `\\?\C:\Users\me\project`
(`HS2-SX3Q6R`).

First-release retention is manual. A 30-day expiry would make saved
instructions stop working as they aged. Explicit cleanup can clear one
project or the entire store. Cleanup skips open bundles, including a
bundle being edited by another Glassbox process. Each removed bundle
releases its Markdown and evidence, and copied instructions for it stop
resolving. A deletion marker keeps partially removed bundles visible to the next cleanup attempt.

A filesystem lease protects each live bundle and is released when the
writer exits. Only directories identified as Glassbox bundles are
eligible for cleanup. Open the Feedback Storage action in the workbench footer to inspect total
and per-project usage. Both cleanup actions show which scope will be removed
and explain that affected copied instructions will stop working. Cleanup
refreshes the totals and reports kept active bundles and any failed removals.
Cancel leaves storage untouched.
