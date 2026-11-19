# Git review inputs

Glassbox's Git comparison core discovers the worktree from a path inside it.
Working-tree review compares the current files to HEAD and adds non-ignored
untracked files. An unborn repository uses the empty tree. Staged and unstaged
review compare the index against HEAD and the worktree against the index,
respectively. A path-limited working-tree review uses repo-relative Git pathspecs.

A commit review compares a commit to its first parent, or to the empty tree
for a root commit. A range compares the two resolved commits. A branch review
compares the merge base of the selected branch and HEAD against HEAD. Revision
resolution occurs before running the diff.

Results include the repository root, ordered file changes with relative old
and new paths, and the raw unified patch. Git supplies the rename resulting
paths and detects binary changes. Review commands disable external diff and
text conversion and isolate the application-selected repository from inherited
Git subprocess state. Text hunk parsing and media presentation are tracked in
`HS2-B7QRKJ` and launch routing in `HS2-TSQ44F`.
