# Direct file and folder comparison

The shared comparison core accepts two explicit paths, with the old side first.
It resolves relative inputs against the calling process's working directory.
Both roots must exist and be two directories or two file entries. Git and
repository discovery are unnecessary for this operation.

For directories, entries pair by exact relative path, preserving case and
native path components. The result contains additions, deletions, and
modifications in path order. Identical content is omitted, and empty directories
do not create changes. Files ignored by Git are still compared. A single-file
comparison keeps both names when the old and new basenames differ.

The comparison streams the content of regular file pairs. Its content hint
classifies the first 8192 bytes for NUL and invalid UTF-8. Symlinks compare by
their stored link target and are never descended into as directory entries.
An unreadable entry or unsupported file type produces an error. The result
includes each side's display path, original source path, and content kind.

Use Files or Folders in the left rail to open a direct comparison
(`HS2-KGVXT8`). Select a changed file from the tree. The text and media
viewers are tracked in `HS2-RVP90A` and `HS2-B9NHFE`.
