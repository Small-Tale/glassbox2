# Analysis latency and reuse, 2026-11-19

Glassbox re-ran the provider on every identical API request. Successful
repeats took 0.84–2.99 seconds on a one-file timeout adjustment and
1.51–1.52 seconds for the reading order of a two-file atomic writer change.
Reuse of exact inputs is worth pursuing. Multi-file risk and guidance
also exposed a provider output issue that needs separate verification
before those jobs can benefit from persisted results.

## Baseline

Apple M5 Pro, macOS 27.2.1, Apple Foundation Models with the compiled
Glassbox adapter, debug shared host at `57b65b4`. Each row used a fresh host
for its first request, then issued the same request three more times.
The Apple model service itself may have been warm. Timings cover job
submission, model discovery, inference, validation, publication, and
50 ms status polling. Both fixtures contain synthetic source.

| Fixture | Mode | First request | Median repeat | Repeat range | Complete |
| --- | --- | ---: | ---: | ---: | ---: |
| Timeout adjustment, one file | Risk | 3,267 ms | 2,772 ms | 2,661–2,986 ms | 4 / 4 |
| Timeout adjustment, one file | Narrative | 997 ms | 995 ms | 839–1,152 ms | 4 / 4 |
| Timeout adjustment, one file | Guidance | 1,205 ms | 1,100 ms | 1,099–1,204 ms | 4 / 4 |
| Atomic writer and concurrent-write test, two files | Risk | 3,766 ms | 8,263 ms | 3,768–8,419 ms | 0 / 4 |
| Atomic writer and concurrent-write test, two files | Narrative | 1,359 ms | 1,518 ms | 1,514–1,519 ms | 4 / 4 |
| Atomic writer and concurrent-write test, two files | Guidance | 2,253 ms | 2,825 ms | 2,510–3,033 ms | 0 / 4 |

The last two failure rows include time to failure. Inspecting responses
to the synthetic guidance fixture showed that the model copied code
into its structured replies, sometimes with malformed delimiters or
escaped strings. A malformed file prevented publication of valid
results from other files. Repair is tracked in `HS2-KNJX2P`.

## Structured output retest

After the repair in `HS2-KNJX2P`, the same atomic writer fixture
completed all four risk and all four guidance jobs. Risk took 7,704 ms
on the first request and 7,072 ms median across repeats. Guidance took
6,047 ms on the first request and 5,966 ms median across repeats. These
are completed inference timings with the repaired Apple adapter, rather
than the prior time-to-failure measurements. The exact-input cache target
is unchanged.

## Reuse decision

Implement exact-input reuse first in `HS2-04RMB6`. Target a median of
250 ms or less for a valid warm request on these fixtures. Include
capture, cache lookup, validation, and the same polling interval in
that measurement. Report cold overhead and verify that a cache hit uses
the same rendering and publication path as a fresh result.

Hash a canonical, versioned input envelope. Include the analysis mode,
prompt and output schema versions, ordered relative file paths and
hunk revisions, skipped inputs, and normalized settings that affect
inference. Identify the adapter implementation and resolved model
revision. Keep entries session-local when a provider cannot identify
the model revision. Exclude credentials and raw code from cache
records and diagnostics.

Persist only fully validated successful results. Keep the cache in
local application data with a bounded size and least-recently-used
eviction. Use atomic writes and coalesce concurrent identical requests.
A cancelled caller must not cancel another caller's active request.
Failed, partial, cancelled, or stale responses cannot populate the
cache. Cached notes must keep existing discussion replies and use
current anchor validation.

An identical historical Git comparison can reuse an exact result while
its normalized inputs still match. The same applies across commits to
unchanged per-file inputs if the implementation later introduces a
per-file cache. A reading-order result requires the full ordered
comparison. A previous commit summary could inform a later model
request, but a summary cannot represent exact findings for a changed
diff. Defer stored summaries until measuring whether that context
improves a later review.

## Reproduce

Build the Rust host and [Apple adapter](../ai-providers.md#verification),
then run:

```sh
node scripts/measure-analysis.mjs target/debug/glassbox-server /tmp/glassbox-provider-apple
```

Append a fixture and mode to repeat a single row. The script creates its
own local review and feedback directories and removes them on exit.
