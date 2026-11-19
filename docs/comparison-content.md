# Comparison content

The comparison core loads a selected file through the direct-path or Git
review entry point. Both return the same content types.

- Text returns unified hunks with original and updated line mappings, per-line
  change types, and an end-of-line marker. Git generates the hunks from the
  selected before and after bytes with three lines of context.
- Image and SVG input returns the original bytes and content type for each
  available side. Diagram inputs recognized by the old Mermaid, Graphviz and
  PlantUML plugins return original source bytes as text. Other binary files
  are identified without turning their bytes into code lines.
- Historical Git inputs are pinned to the resolved commits. Index and worktree
  views read the index and working files when the selected entry is requested.
  Git LFS pointers are classified as unavailable binary content.

The v1 renderer contracts in `docs/29-content-plugins.md` of Glassbox v1 used
extension-based discovery, then passed one side to a renderer or both sides to
a differ. The v2 content layer gives the next layer names and input bytes.
Renderers retain responsibility for time limits and safe, inert display.
Ground-truth image comparison is retired.
