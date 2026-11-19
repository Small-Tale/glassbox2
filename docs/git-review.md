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

## Git difftool

`glassbox-cli` runs Git's difftool with Glassbox selected for that invocation.
Git interprets revision, pathspec and difftool arguments. For example:

```sh
glassbox-cli --no-prompt HEAD -- src/
glassbox-cli --dir-diff main HEAD
```

Provide `git` and `glassbox-desktop` on PATH for the desktop client.
To run the browser host instead, set `GLASSBOX_DIFFTOOL_CLIENT` to the
`glassbox-server` executable and `GLASSBOX_WEB_ASSETS` to the built web
directory. Use absolute paths when setting either variable. The browser
host prints its loopback address. Stop it from the terminal when done.

Git invokes the client once per file or once for an entire directory diff.
The client runs in the foreground so Git's temporary inputs stay valid until
the client exits. The wrapper defaults to real directory copies and reports
client failures. Git's own flags can override those defaults.

To use plain `git difftool --tool=glassbox`, configure the following tool
entry in the desired Git config scope. The wrapper needs no persistent config.

```ini
[difftool "glassbox"]
    cmd = glassbox-cli --git-difftool "$LOCAL" "$REMOTE"
```

The shared host exposes the current launch paths through
`GET /api/v1/difftool`, available only when started by difftool.
The workbench opens that source automatically and lists the changed files (HS2-KGVXT8).
