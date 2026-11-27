# Deterministic demo capture

`HS2-5HS40W` adds the harness that produces Glassbox's demo stills and animations. A scene is plain data; running it
against the real built workbench yields PNG stills and self-contained SVGs through
[domotion-svg](https://github.com/brianwestphal/domotion), and the same scene run again yields the same bytes. The public
showcase (`HS2-WRKR5E`) and the version-comparison suite (`HS2-5TFS63`) share this one format.

## Run it

Build the host and the client once, then run a suite:

```
cargo build -p glassbox-server
npm --prefix clients/web run build
npm --prefix clients/web run demo:capture -- --suite comparison --runs 3
```

| Option    | Meaning                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `--suite` | `public` (default) or `comparison`.                                              |
| `--scene` | Run one scene by id.                                                             |
| `--runs`  | How many fresh runs to compare (default 3). Any byte difference fails the run.   |
| `--out`   | Output folder, default `clients/web/demo-output/<suite>`. It is never committed. |

Each run starts its own host and its own Chromium. The command exits non-zero and names the differing artifacts when
runs disagree, and otherwise writes the artifacts of the last run.

## Requirements

- **Seeded fixtures.** Two fixture repositories (a changed `Fieldnotes` and a clean `Quiet`) are rebuilt at fixed paths
  (`/tmp/glassbox-demo` on macOS and Linux) with fixed contents and one author and commit time. The host runs with its
  own empty settings and feedback folders and with every optional renderer and AI provider switched off, so no run reads
  the network or the machine. AI-response scenes are not built yet (`GB2-K6ZB5B`).
- **Frozen environment.** The window is fixed (size, scheme, locale `en-US`, time zone UTC, device scale 1). The page's
  `Date`, `Math.random` and `crypto.randomUUID` are replaced before any page script runs, and animations, transitions and
  the caret are switched off.
- **Named sync points, no sleeps.** A frame advances only when the app shows a named ready state: `source-entry`,
  `review`, `diff`, `comment-saved` or `media`. A policy test fails if the harness waits on a duration.
- **Opt-in states.** A frame with `state: 'loading' | 'empty' | 'error'` captures that state on purpose: loading holds the
  files request behind a promise, empty opens the clean repository, and error opens a repository that does not exist so
  the host's real error shows. Any other frame waits for a settled review, so a spinner never appears by accident.
- **One scene format.** Scenes live in `clients/web/demo-capture/scenes.mjs` and are checked by `validateScene`
  (`scene.mjs`). A scene names its suites, window, kind (`still` or `animation`) and frames; a still has one frame and an
  animation at least two. Steps are `open-comparison`, `select-file`, `comment` and `appearance`.
- **Artifacts.** A still gives `<id>.png` and `<id>.svg`. An animation gives one `<id>-<frame>.png` per frame and one
  animated `<id>.svg` that crossfades between them.
- **Flake check.** `--runs N` compares every artifact byte for byte across fresh runs.

## Sample scenes

- `review-comment`, a still: a text diff with one comment.
- `review-tour`, an animation: the changed files, the diff, a commented line, then the dark scheme.

Both match across three Chromium runs on macOS (`tests/browser/demo-capture.test.mjs`). The same test runs on every
platform the web browser job covers. Determinism is within one machine: different operating systems rasterize text
differently, so compare artifacts only between runs on the same platform.

## Tests

- `tests/demo-capture.test.mjs` covers the scene format, the suites, the byte comparison and the no-sleep rule.
- `tests/browser/demo-capture.test.mjs` runs both sample scenes three times and checks identical bytes, and runs one scene
  with a loading, an empty and an error frame to prove the opt-in states look different from a settled review.
