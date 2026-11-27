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

One `glassbox-cli` invocation is one review (`HS2-559FEK`). The wrapper always
asks Git for directory mode, so Git launches the client once for every changed
file in that run, lists the files in a stable order and keeps their temporary
inputs until the client exits. Separate invocations, including concurrent runs
in the same repository, are separate reviews. The client runs in the foreground
and the wrapper reports client failures. It defaults to real directory copies;
Git's other flags, such as `--symlinks`, can override that.

Plain `git difftool` with the registered default also opens one review per run
(`GB2-FXJSSM`), although Git starts the tool once per file and deletes each
file's temporary inputs when the tool returns. Git numbers the files of a run
(`GIT_DIFF_PATH_COUNTER` of `GIT_DIFF_PATH_TOTAL`), and the registered entry
passes the run's process id (`$PPID`, the same `git diff` for every file) and the
file's repository path (`$MERGED`). On Windows the shell's `$PPID` is not a per-run
key, so `glassbox-cli` keys the run by the creation time of the nearest `git.exe`
above it, the same `git diff` for every file (`GB2-3VR7XA`). Every file but the last is copied into a
private staging folder (`glassbox-difftool-<id>` under the temporary directory)
and its launch returns at once; the last file opens the client once on the two
staged folders, which it compares as a directory pair, waits for it, and removes
the folder. Separate and concurrent runs have different process ids, so they are
separate reviews. The first file of a run starts its folder empty and removes
Glassbox staging folders older than a day, so an interrupted run leaves nothing
that reaches the next one. A run of one file, a launch without the numbering
(an older registered entry, or `--dir-diff`, which Git does not number) and
every other case open the client per launch, as before. Limits: a renamed file
shows as a modification of its new path, a run stopped before its last file
never opens the client, and on Windows a launch with no `git.exe` ancestor opens
its own review as before.

Glassbox is always the selected tool (`HS2-40BYH7`). `glassbox-cli` forwards
its arguments to `git difftool` in order, after its own fixed options, and
Git interprets revisions, ranges, `--cached` and similar, pathspecs after `--`
and paths with spaces exactly as it does for `git difftool`. It rejects, before
Git or the client runs, the options that would choose a different tool or stop
a tool from launching: `-t`, `--tool`, `-x`, `--extcmd`, `-g`, `--gui`,
`--no-gui` and `--tool-help`, in any spelling Git accepts, including
unambiguous long-option abbreviations (`--to=vimdiff`) and short-option
clusters (`-dt vimdiff`). Everything after `--` is a pathspec and is never
read as an option, so a file named `-t` can still be compared.

To use plain `git difftool --tool=glassbox`, configure the following tool
entry in the desired Git config scope. The wrapper needs no persistent config.

```ini
[difftool "glassbox"]
    cmd = GLASSBOX_DIFFTOOL_SESSION="$PPID" GLASSBOX_DIFFTOOL_PATH="$MERGED" glassbox-cli --git-difftool "$LOCAL" "$REMOTE"
```

The shorter entry `glassbox-cli --git-difftool "$LOCAL" "$REMOTE"` still works but
opens one review per file.

### Default Git difftool

To make plain `git difftool` open Glassbox, register it in one Git
configuration scope that you name (`HS2-HVP8Q1`):

```sh
glassbox-cli --register-git-difftool --global   # every repository for this user
glassbox-cli --register-git-difftool --local    # the current repository only
glassbox-cli --unregister-git-difftool --global
glassbox-cli --unregister-git-difftool --local
```

The scope is required and the command reports which one it changed; it never
edits the other scope or the system configuration. `glassbox-cli` must be on
`PATH` when Git runs, because the tool entry calls it by name.

- Registering writes the tool entry above and sets `diff.tool` to `glassbox`.
  If `diff.tool` was a different tool, the command keeps it in
  `difftool.glassbox.previousDefault` and reports that. All other settings,
  including `difftool.prompt` and other tools' entries, are untouched.
- Registering again changes nothing. It refuses, and writes nothing, when a
  `difftool.glassbox.cmd` that Glassbox did not write already exists. An entry
  written by an earlier version (the shorter one above) is Glassbox's own, so
  registering updates it to the grouping entry and unregistering removes it.
- Unregistering sets `diff.tool` back to the saved default, or removes it when
  none was saved. If `diff.tool` has since been changed to another tool, it is
  left alone and the command says so. It removes only the entries it can show
  are its own and succeeds when nothing is registered.
- Registration does not set `difftool.trustExitCode`, which is global to every
  tool. Plain `git difftool` therefore ignores a client failure unless you pass
  `--trust-exit-code`; `glassbox-cli` always does.

The shared host exposes the current launch paths through
`GET /api/v1/difftool`, available only when started by difftool.
The workbench opens that source automatically and lists the changed files
(`HS2-KGVXT8`). It displays the comparison immediately when difftool
supplies exactly one changed file (`HS2-Y8769S`).

## Changed-file actions

Selecting a changed file exposes actions to copy its relative or absolute
path, reveal it in the file manager, or open it in the system’s default
application. The web and Tauri clients resolve absolute paths and desktop
actions through the shared local host. Git comparisons resolve the selected
path under the repository’s working tree. Direct comparisons use the selected
entry’s after side, falling back to the before side for deletions. The host
reports when a comparison path has no live file for a desktop action. Git
difftool inputs represent comparison snapshots, so that mode offers the
display path only.

## File order

The navigator's **Order Files** control switches the changed-file list between **Path** (the folder tree, the
default), **Risk** and **Narrative** (`HS2-5P1B23`). Risk lists files highest aggregate risk first under
"Highest Risk First", each with a High, Medium or Low Risk badge and its rationale; ties fall back to path order.
Narrative lists the files in the narrative analysis's order under "Review in This Order", numbered Step 1, Step 2
and so on with each step's reason. Choosing an order runs that analysis if it has not run for this comparison, and
the list says it is working until the result arrives; Risk also fills in when the Risk Analysis toolbar control
is turned on.

No file is hidden by an order: files the analysis did not reach stay listed after the ordered ones under
"Not Analyzed" or "Not in the Narrative", files whose analysis failed are listed apart under "Analysis Failed"
with the reason, and an unavailable or failed analysis shows its message with every file under the unreached
heading. Path returns to the folder tree. Selecting, filtering, reviewed marks and file actions work the same in
every order, and the labels show the file name with its folder and the finding beneath it.

## Review progress

Select a changed file and press Mark Reviewed (a check in the selected-file actions) to record that
you have reviewed it (`HS2-FTEQVQ`). A reviewed file shows a check beside its status badge, and the
navigator's Files Reviewed bar reads "1 of 12" for the open comparison. Pressing the button again
clears the mark. Only per-file progress is tracked; there is no review-complete state.

- A mark belongs to the comparison it was made in, identified the way saved reviews identify it, and
  persists in the per-user settings file under `reviewProgress`, so reopening the same comparison
  shows it again and another comparison starts empty.
- A mark records the revision of the content you reviewed: the text revision, both image
  revisions, or a fixed marker for binary and unavailable Git LFS files. The host checks each marked
  file when the comparison opens. A file whose content changed since the mark shows "Changed Since
  Reviewed" instead of a check and is not counted until you review it again. Binary files carry no
  revision of their own, so a changed binary stays reviewed.
- `POST /api/v1/review/progress` lists the marks for a source as `reviewed` or `changed`.
  `POST /api/v1/review/progress/mark` sets or clears one; it answers 409 when the revision the client
  shows is no longer current, so a mark is never stored against content you did not see.

## File navigation history

The comparison toolbar offers Previous File Visit and Next File Visit.
Use Command-`[` or Command-`]` on macOS, or Alt-Left and Alt-Right
on Windows and Linux. Each visit remembers its vertical comparison
scroll and horizontal text scroll. Visiting another file after moving
back clears forward visits. Opening a comparison starts a new history
(`HS2-2275EE`).
