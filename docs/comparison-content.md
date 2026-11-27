# Comparison content

The comparison core loads a selected file through the direct-path or Git
review entry point. Both return the same content types.

- Text returns unified hunks with original and updated line mappings, per-line
  change types, and an end-of-line marker. Git generates the hunks from the
  selected before and after bytes with three lines of context.
- Image and SVG input returns the original bytes and content type for each
  available side. Diagram inputs recognized by the old Mermaid, Graphviz and
  PlantUML plugins return original source as text. A configured [diagram renderer](content-plugins.md) can preview either side of the comparison. Other binary files
  are identified without turning their bytes into code lines.
- Historical Git inputs are pinned to the resolved commits. Index and worktree
  views read the index and working files when the selected entry is requested.
  Git LFS media pointers resolve through the repository's local object cache,
  including a configured `lfs.storage` directory (`HS2-YMDPBP`). Glassbox
  retains the object ID and size and checks both against the cached bytes.
  Missing or mismatched objects are reported in the comparison. Glassbox
  reads the local LFS cache without fetching. Direct path comparisons
  continue to treat a bare pointer as binary content.

The LFS storage directory follows the [Git LFS configuration](https://github.com/git-lfs/git-lfs/blob/main/docs/man/git-lfs-config.adoc).

The v1 renderer contracts in `docs/29-content-plugins.md` of Glassbox v1 used
extension-based discovery, then passed one side to a renderer or both sides to
a differ. The v2 content layer gives the next layer names and input bytes.
Renderers retain responsibility for time limits and safe, inert display.
Ground-truth image comparison is retired.

## Text viewer

The center panel renders selected text files as side-by-side or inline
diffs (`HS2-RVP90A`). Both preserve before and after line numbers,
added and removed lines, hunk ranges, and missing-final-newline markers.
Common source files receive lightweight syntax cues. Wrap works in either
layout. Wrapped rows grow to fit all their code as the workbench narrows
(`HS2-V6962Y`, `HS2-JEM47K`). With Wrap off, long lines can scroll within the comparison. The layout starts
automatic: side by side on a wide window and inline where one pane shows at a time; choosing a layout keeps it.
On a narrow toolbar the secondary tools move into a More Tools menu (`GB2-8T670B`).

The workbench requests selected content using
`POST /api/v1/review/file`. The service checks the selected index and
path against the comparison before loading content. It returns text
hunks, media metadata, a binary indicator, or the unavailable LFS sides.
Media metadata includes each available side's content type, byte count,
and revision. The web host serves the original bytes through
`POST /api/v1/review/media` after checking the selection, side, and
revision. It accepts region feedback only when the anchor matches that
side's current revision.

### Unchanged context (`HS2-DZ8ZR6`)

The viewer shows three lines around each change and hides the rest. A control row
marks every hidden run: before the first change, between two changes and after the
last one. Each offers "Show 20 Above" (lines directly above the next change),
"Show 20 Below" (lines directly below the previous change) and "Show All N" when
the run fits one request (500 lines). A run of 20 lines or fewer has one "Show N
Lines" control. Pressing a control repeats: each press reveals the next lines,
numbered on both sides, and the control row stays until nothing is hidden. Once
the lines touching the next change are shown, the `@@` header for that change is
dropped, and a fully revealed run merges the two changes into one stretch.

`POST /api/v1/review/context` returns lines `start` to `end` of the displayed side
for the text `revision` the client holds. It checks the selection like the other
endpoints, rejects a range over 500 lines, and answers 409 when the source has
changed since the file opened, so the client never mixes lines from a changed file
into a stale diff. The file response carries `after_lines`, the displayed side's
line count, so the trailing run is known without a request. A failed or refused
request shows a "Could Not Show Lines" alert in the control row and keeps what was
already revealed. Opening another file, or reloading the comparison, collapses the
file again.

Revealed lines take comments like the diff's own lines (`GB2-5QQPPW`): the comment action appears on a
revealed line's number, and the thread shows under that line. The host accepts any line the chosen side of the
file has, in the revision on screen, so a line past the end or a changed file is still refused (409).

### Find in the diff (`HS2-30ZEFE`)

A Find field in the text diff's toolbar searches the lines the diff is showing:
the lines of every change plus any unchanged lines you have revealed. Lines still
hidden are not searched, which the field's placeholder, "Find in Shown Lines", says;
reveal them and the matches update. Press Ctrl+F (Cmd+F on macOS) while a text diff is
open, or choose the search icon, to open the field with focus in it.

- Matching ignores case and treats the query as plain text. Every match is
  highlighted and the current one is stronger. The field reads out "3 of 12" or
  "No matches".
- Enter and Shift+Enter, or the Previous and Next buttons, move through the matches
  and wrap at both ends. The diff scrolls to the current match. Matches are ordered by
  the lines' order in the diff, with removed lines before the added lines that replace
  them, in both layouts.
- Side by Side shows an unchanged line on both sides and marks it on each, but counts
  it once. Inline marks it once.
- Another file keeps the query and starts at its first match. Escape clears the query,
  the highlights and the count; Escape again on the empty field collapses it. Stepping
  and the buttons are disabled, not hidden, while there is nothing to step to.

## Image viewer

Raster and SVG comparisons open side by side. The toolbar offers stacked,
single-side, difference, slice, and metadata views. SVGs can also be read
as source. A file opens in the mode you last chose, orientation included
(`HS2-Q3X4BX`): choose Over and Under once and later pairs open stacked.
When the next file lacks an input the mode needs (an added or removed image
cannot be stacked, differenced or sliced, and a raster image has no source),
the viewer shows Side by Side with a status line naming the unavailable mode.
Your choice returns on the next file that supports it, and picking a mode
clears the line. Zoom, slice position and region drawing still reset for each
file. Rendered SVGs load as images through opaque data URLs that
preserve the original asset bytes. Zoomed views can be panned with
scrolling. Select Add Region Comment and drag on a before or after image
to open a region discussion in the shared inspector. With the tool active,
focus either image and use the arrow keys to move the selection or Shift
with the arrow keys to resize it. Enter opens the comment, and Escape
cancels. Saved rectangles
reopen their discussions on the matching image revision (`HS2-B9NHFE`).

### Synchronized view and Focus (`HS2-XJWGYD`)

In Side by Side and Over and Under the two images share one zoom and one position. Zoom with the toolbar or
with Ctrl (Cmd on macOS) and the wheel, which a trackpad pinch also sends; each gesture is one 25% step within
the toolbar's 100% to 400% range, and both images follow. Panning one image, by scrolling or dragging its
scrollbars, moves the other to the same relative place in its own range, so images of different sizes stay
aligned on the same spot rather than the same pixel.

Each pane has a **Focus** action that shows that image alone at the current zoom, in the place you were
looking at. **Exit Focus**, or Escape with the image focused, returns to the Side by Side or Over and Under view
you left, at the zoom it had, and keeps you at the same relative place. Focus is separate from the toolbar's
Before Image and After Image modes: those are a chosen view with nothing to exit. Saved region comments sit at
fixed fractions of their image, so they keep their place across zoom, pan, Focus and Exit Focus.

### Region comments (`HS2-9MZ32M`)

Select an image region in the Inspector to edit it. **Edit Region** starts the same draft you use to draw a
new region, placed over the saved one on its own side of the image: arrow keys move it, Shift with the arrow
keys resizes it, and dragging on the image draws a replacement. Enter, or releasing the drag, saves it;
Cancel, or Escape, leaves the saved region as it was. Saving is the host's validated move
(`docs/feedback.md`, "Move Comment"): the region keeps its thread, replies and attachments, must stay inside
the image with a positive size (400 otherwise), and must carry the image's current revision, so a changed
image answers 409 and the draft returns for another try. A region stays on its side; one drawn on the other
image is refused.

When no thread is selected, the Inspector offers **Comment on Whole Before Image** and **Comment on Whole After
Image** for each image the comparison has. They start a normal comment draft whose region covers the full image
at its current revision, which is the way to comment on an image as a whole.
