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
| `--out`   | Output folder. The default `clients/web/demo-output/<suite>` is ignored by Git. |
| `--showcase` | Public suite only. Write one PNG per still and one animated SVG for the hero. |

Each run starts its own host and its own Chromium. The command exits non-zero and names the differing artifacts when
runs disagree, and otherwise writes the artifacts of the last run.

## Regenerate the README showcase

Run the following commands from the repository root. The showcase images in
`docs/demo-assets` are tracked. Use the same macOS Chromium environment for a
byte comparison with the checked-in images.

```sh
cargo build --locked -p glassbox-server
npm --prefix clients/web run build
npm --prefix clients/web run demo:capture -- --suite public --runs 3 --showcase --out ../../docs/demo-assets
```

The README embeds the Git review tour and stills for direct comparisons, images,
symbol navigation, inline comments, AI analysis and feedback sharing
(`HS2-WRKR5E`).

## Compare archived v2 captures

Build the host and web client before recording. Use the same machine and
Chromium environment to record both versions (`HS2-5TFS63`).

```sh
npm --prefix clients/web run demo:capture -- --suite comparison --version v2-first
npm --prefix clients/web run demo:capture -- --suite comparison --version v2-next
npm --prefix clients/web run demo:compare -- --baseline v2-first --current v2-next
npm --prefix clients/web run demo:coverage -- --check
```

Version archives are stored under `clients/web/demo-output/versions`. The
manifest records the source commit, dirty status, platform, architecture, scene
selection, and PNG and SVG digests. Capture refuses to replace an existing
version and publishes an archive only after all selected scenes agree across
the requested runs. Use `--scene` to record an explicitly limited sample.
Comparison checks the digest of every stored artifact and exits nonzero when
images changed, were added, or were removed. Accepting intentional changes
means selecting the approved version as the next baseline.

The comparison suite includes the public scenes and the real Workbench’s
empty, loading, and error states across wide, medium, and narrow viewports in
both color schemes. `demo:coverage` lists the Glassbox catalog entries and
user flows, their captured frames, and missing profiles. Its `--check` mode
fails while gaps remain. The full matrix and first complete version baseline
are still tracked by `HS2-5TFS63`. Chromium PNG raster differences can also
prevent an archive from being recorded (`GB2-Q71QW4`).

## Requirements

- **Seeded fixtures.** Two fixture repositories (a changed `Fieldnotes` and a clean `Quiet`) are rebuilt at fixed paths
  (`/tmp/glassbox-demo` on macOS and Linux) with fixed contents and one author and commit time. The host runs with its
  own settings, analysis cache and feedback folders with optional renderers switched off. An analysis scene opts in
  with `analysis: 'fixture'`. The runner compiles the local test provider once for its repeated captures and approves
  only that provider for the scene. The fixture cites a commit from the seeded repository (`GB2-K6ZB5B`).
- **Frozen environment.** The window is fixed (size, scheme, locale `en-US`, time zone UTC, device scale 1). The page's
  `Date`, `Math.random` and `crypto.randomUUID` are replaced before any page script runs, and animations, transitions and
  the caret are switched off.
- **Named sync points, no sleeps.** A frame advances only when the app shows a named ready state: `source-entry`,
  `review`, `diff`, `comment-saved`, `media`, `outline`, `share-menu`, `analysis-risk`, `analysis-narrative` or
  `analysis-note`.
  The analysis states wait for the ordered navigator or the cited note in the discussion inspector.
  Before reading a settled frame, the runner moves the pointer off the controls, waits for in-flight host requests,
  and lets Chromium paint with the loaded fonts. A deliberately held loading frame skips the host wait.
- **Opt-in states.** A frame with `state: 'loading' | 'empty' | 'error'` captures that state on purpose: loading holds the
  files request behind a promise, empty opens the clean repository, and error opens a repository that does not exist so
  the host's real error shows. Any other frame waits for a settled review, so a spinner never appears by accident.
- **One scene format.** Scenes live in `clients/web/demo-capture/scenes.mjs` and are checked by `validateScene`
  (`scene.mjs`). A scene names its suites, window, kind (`still` or `animation`) and frames; a still has one frame and an
  animation at least two. Steps include `open-comparison`, `select-file`, `comment` and `appearance`.
  Fixture scenes also support `order-files` for risk or narrative and `open-ai-note`.
- **Artifacts.** A still gives `<id>.png` and `<id>.svg`. An animation gives one `<id>-<frame>.png` per frame and one
  animated `<id>.svg` that crossfades between them.
- **Flake check.** `--runs N` compares every artifact byte for byte across fresh runs.

## Sample scenes

- `review-comment`, a still: a text diff with one comment.
- `review-analysis`, a still: risk-ordered files and an AI note citing the previous summary.
- `review-tour`, an animation: the changed files, the diff, a commented line, then the dark scheme.
- `direct-comparison`, `image-comparison`, `review-outline` and `review-handoff` capture those focused flows.

The browser tests compare three Chromium runs of each scene. The same tests run on every
platform the web browser job covers. Determinism is within one machine: different operating systems rasterize text
differently, so compare artifacts only between runs on the same platform.

## Tests

- `tests/demo-capture.test.mjs` covers the scene format, the suites, the byte comparison and the no-sleep rule.
- `tests/browser/demo-capture.test.mjs` runs each sample scene three times and checks identical bytes, and runs one scene
  with a loading, an empty and an error frame to prove the opt-in states look different from a settled review.
  CI retains divergent PNG or SVG files in `demo-repeat-failures` inside its browser artifact (`GB2-Q71QW4`).
