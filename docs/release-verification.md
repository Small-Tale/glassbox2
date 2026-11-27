# macOS and Linux release verification

`HS2-RV5N3K` tracks verification of the 20 decisions accepted in the
[v1 audit sign-off](v1-gap-audit.md#sign-off). The implementation tickets are
complete. Release verification still requires the installed smoke checks below
and the open real-app checks in the coverage table.

## Feature coverage

Web model tests live in `clients/web/tests/`. Workbench checks run the built
client against a real loopback Glassbox host in
`clients/web/tests/browser/workbench.test.mjs`. Rust paths below are relative
to the named crate. A recording launcher verifies the launch arguments and
exit status at the operating-system process boundary.

| Audit decision                                        | Unit, model or contract coverage                                                                | End-to-end or remaining manual evidence                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D03 Saved reviews and handoff actions                 | `saved-review-state.test.mjs`, `export-state.test.mjs`, `handoff.test.mjs`                      | Workbench saved-review restoration and deletion, Send to Hot Sheet 2 dialog, and the real-ticket integration checks in [hosting](hosting.md#first-release-platform-checks). |
| D04 Fixed Glassbox difftool and direct CLI invocation | CLI argument validation in `glassbox-cli/src/main.rs`                                           | `glassbox-cli/tests/difftool.rs` drives real Git and records client arguments. The Workbench and Tauri tests open real difftool inputs. Installed launch is still required. |
| D05 Difftool registration and removal                 | `glassbox-cli/tests/register.rs` checks scope, repeat registration and restoring the prior tool | The same test file invokes plain Git difftool before and after unregistering using an isolated Git configuration.                                                           |
| D06 One review per Git invocation                     | Grouping in `glassbox-cli/src/group.rs`                                                         | `glassbox-cli/tests/difftool.rs` and `tests/register.rs` cover grouping and separate invocations with real Git and a recording client.                                      |
| D07 Reveal unchanged context                          | `context-expansion.test.mjs`, `glassbox-server/tests/review_files.rs`                           | Workbench reveals context repeatedly in both layouts and refuses a changed source.                                                                                          |
| D08 Symbol outline                                    | `symbol-outline.test.mjs`, `glassbox-server/tests/review_outline.rs`                            | Workbench jumps to declarations on either side and disables the action for unsupported files.                                                                               |
| D09 Find in diff                                      | `diff-find.test.mjs`                                                                            | Workbench finds, steps and clears matches across context, layouts and files.                                                                                                |
| D10 Move a line discussion                            | `discussion.test.mjs`, `glassbox-server/tests/review_move.rs`                                   | Workbench moves a discussion across lines and sides and refuses a hidden destination.                                                                                       |
| D11 Re-anchor a stale discussion                      | `discussion.test.mjs`, `glassbox-server/tests/review_move.rs`                                   | Workbench suggests a unique destination and keeps ambiguous and missing matches stale.                                                                                      |
| D12 Public feedback JSON                              | `glassbox-feedback/tests/export.rs` checks the golden file and a consumer                       | `glassbox-server/tests/review_move.rs` verifies `feedback.json` beside `review.md` after real-host publication.                                                             |
| D13 Order files by risk or narrative                  | `file-order.test.mjs`                                                                           | The catalog covers the navigator interaction. The built Workbench flow is tracked in GB2-N9HQJT.                                                                            |
| D14 Per-comparison review progress                    | `review-progress.test.mjs`, `glassbox-server/tests/review_progress.rs`                          | Workbench preserves marks on reopening and drops a mark when the file changes.                                                                                              |
| D17 Synchronized image gestures and Focus             | `media-gesture.test.mjs`, `media-mode.test.mjs`                                                 | Workbench pans and zooms unequal image sides together and focuses either side.                                                                                              |
| D18 Edit a region or comment on the whole image       | `media-region.test.mjs`                                                                         | Workbench redraws a region via keyboard and pointer and creates a whole-image comment.                                                                                      |
| D19 Verified attachment previews and external open    | `attachment-preview.test.mjs`, `glassbox-server/tests/review_attachments.rs`                    | Workbench previews safe attachments, refuses unsupported files and requests external open through the recording launcher. Verify a real OS opener during installed smoke.   |
| D20 Renderer setup and readiness                      | `renderer-state.test.mjs`, `glassbox-render-local/tests/protocol.rs`                            | Workbench detects missing and newly configured tools. The [Local diagram tools workflow](../.github/workflows/diagram-tools.yml) exercises installed engines on demand.     |
| D22 Open a cited commit in a new review               | `discussion-commit-link.test.mjs`, `glassbox-server/tests/review_commit_links.rs`               | Workbench opens the cited line in a new tab and preserves the original review.                                                                                              |
| D23 Open desktop links in the default browser         | `clients/web/src-tauri/src/main.rs` checks routing and uses a recording opener                  | Real Linux WebKitGTK clicks are recorded in HS2-E6C9C9. The real macOS window check is tracked in GB2-DFGR87.                                                               |
| D26 Opt-in browser launch after startup               | `glassbox-server/tests/launch.rs`                                                               | The real host is launched with a recording browser opener to verify readiness, headless mode and failure behavior.                                                          |
| D27 Retain image view mode across files               | `media-mode.test.mjs`                                                                           | Workbench preserves the selected mode and falls back when the next file lacks support.                                                                                      |

## Shipping CI

Require a successful push run of [Kerf scaffold](../.github/workflows/kerf.yml)
on the shipping branch, covering the candidate commit. Check the macOS and
Linux jobs for web checks, Rust tests and native startup with built assets
and the full browser suite. Use the workbench captures to investigate failures.

## Installed-package smoke plan

Run on a clean macOS account and a clean, supported Linux desktop. Use the
exact distribution artifacts that HS2-QJCQHF selects. Capture the candidate
commit, package version and checksum, OS and architecture, the command or UI
action used, and the result of each step. Keep test repositories and settings
disposable.

1. Install the desktop app and CLI through the selected distribution channel.
   Launch the app from the OS and verify that the window shows the workbench
   with its bundled assets. Open a small Git review and a direct file pair.
   Restart the app and verify that a changed appearance setting survives.
2. Invoke the installed CLI directly with a revision range and pathspec in a
   repository whose path contains spaces. Verify that the review opens and
   shows the expected files. Check that invalid arguments produce a useful
   error and exit unsuccessfully.
3. Register the installed CLI as Git difftool in the test repository. Run
   `git difftool --no-prompt` across at least two changed files. Verify that
   one run opens one review with both files, a second run opens a separate
   review, and unregistering restores the prior tool.
4. In the installed desktop app, open a verified attachment externally and
   follow an HTTPS link. Verify the OS opens the appropriate application and
   the Glassbox review stays open. In a browser-capable host installation,
   confirm that `--open` opens a usable page once and a launch without
   `--open` stays headless.
5. If the package ships renderer adapters, configure an installed renderer
   and open a small diagram. Check that its setup state is visible and the
   rendered diagram appears. If the package supports Hot Sheet delivery,
   publish to an isolated ticket store and compare the resulting attachments
   and `feedback.json` with the review.
