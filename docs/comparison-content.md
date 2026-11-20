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
layout. With Wrap off, long lines can scroll within the comparison.

The workbench requests selected content using
`POST /api/v1/review/file`. The service checks the selected index and
path against the comparison before loading content. It returns text
hunks, media metadata, a binary indicator, or the unavailable LFS sides.
Media metadata includes each available side's content type, byte count,
and revision. The web host serves the original bytes through
`POST /api/v1/review/media` after checking the selection, side, and
revision. It accepts region feedback only when the anchor matches that
side's current revision.

## Image viewer

Raster and SVG comparisons open side by side. The toolbar offers stacked,
single-side, difference, slice, and metadata views. SVGs can also be read
as source. Rendered SVGs load as images. Zoomed views can be panned with
scrolling. Select Add Region Comment and drag on a before or after image
to open a region discussion in the shared inspector. With the tool active,
focus either image and use the arrow keys to move the selection or Shift
with the arrow keys to resize it. Enter opens the comment, and Escape
cancels. Saved rectangles
reopen their discussions on the matching image revision (`HS2-B9NHFE`).
