# AI provider plugins

Glassbox uses a shared Rust provider registry and a versioned subprocess
protocol. This follows the manifest and behavioral plugin boundary in Hot
Sheet 2’s AI-tool plugin design. The protocol is available to the local host
and headless callers. [Optional analysis](#optional-review-analysis) uses that contract for risk, reading order, and guided review. The workbench controls are tracked in `HS2-487RGX`.

## First-release coverage

| Glassbox v1 provider | Glassbox v2 coverage |
| --- | --- |
| Local OpenAI-compatible server, including Ollama and LM Studio | The `glassbox-provider-local` executable supports loopback servers on macOS, Linux, and Windows. Configure the numeric loopback socket address with the `address` setting. The default is `127.0.0.1:11434`. |
| Apple Foundation Models | The optional `plugins/ai/apple-foundation/provider.swift` adapter targets Apple Silicon and macOS 26 or later. It reports unavailable when the on-device model cannot run. |
| OpenAI, Anthropic and Google | Deferred until the app has provider credential storage and a user-visible choice about sending review material remotely. |

The local HTTP adapter uses the server’s Chat Completions and Models
endpoints under `/v1`. The address must be loopback and redirects are rejected.
The local model and the optional Apple adapter run independently. Retry and
fallback decisions belong to the analysis caller.

## Discovery and invocation

The host chooses a provider directory and loads its regular JSON files. Each
manifest declares `version` (currently 1), `id`, `name`, and an absolute
`executable` path. Discovery is read-only, reports invalid manifests and
duplicate IDs, and never starts a process. Before invoking a provider, the
host must explicitly approve its executable path. The subprocess runs with the
host user’s OS permissions, so only approve executables the user trusts.

The host sends a UTF-8 JSON object to stdin and closes the stream. It contains
the protocol version, a provider-specific settings object, and a request
tagged with `method`. The methods are `list_models` and `generate`. A generation
request takes a model ID, system instruction and prompt. The subprocess writes
one JSON reply to stdout and exits. The reply echoes the version and uses a
tagged outcome for models, generated text or a failure code.

Stable failure codes are unavailable, authentication required, unknown model,
request rejected and backend failure. The host also reports errors for process
failure, invalid JSON, unsupported protocol versions, oversized messages and
timeout. Dropping the invocation future cancels the direct subprocess. The
host bounds requests and responses to 4 MiB, with a deadline set by the caller.
The local adapter also bounds its HTTP responses.

## Verification

`cargo test --locked -p glassbox-ai` runs registry and subprocess contract tests
against a local HTTP fixture, including discovery, generation, typed errors,
deadline and cancellation. To exercise a real OpenAI-compatible engine,
start an engine with a model installed and run:

```sh
cargo test --locked -p glassbox-ai real_provider_smoke -- --ignored
```

With Xcode and an available Apple Intelligence model, the same test can use the
Apple executable:

```sh
swiftc -parse-as-library -target arm64-apple-macosx26.0 \
  plugins/ai/apple-foundation/provider.swift -o /tmp/glassbox-provider-apple
GLASSBOX_AI_SMOKE_EXECUTABLE=/tmp/glassbox-provider-apple \
  cargo test --locked -p glassbox-ai real_provider_smoke -- --ignored
```


## Optional review analysis

Set `GLASSBOX_AI_PROVIDER_DIRECTORY` to the provider manifest directory and
`GLASSBOX_AI_PROVIDER` to the ID of a trusted provider before starting the
shared host. The host never chooses or runs a provider by discovery alone.
`GLASSBOX_AI_MODEL` can select a specific advertised model. If omitted, the
first advertised model is used. An optional `GLASSBOX_AI_PROVIDER_SETTINGS`
JSON object supplies adapter options. For example, a local HTTP adapter can
use `{"address":"127.0.0.1:1234"}`.

Send the active comparison source and `mode` (`risk`, `narrative`, or
`guidance`) to `POST /api/v1/review/analysis`. The response identifies the
analysis job. `GET /api/v1/review/analysis/{id}` reports progress and results,
and DELETE on the same path cancels an active job. The job distinguishes
unavailable providers, invalid responses, cancellation, and a comparison
changed during generation.

Risk scores cover security, correctness, error handling, maintainability,
architecture, and performance. The aggregate is the highest dimension.
Guidance returns a file overview and line-specific teaching steps.
Narrative analysis gives the reviewer an ordered file list with a rationale
for each step. Anchored notes cite only a valid line and side in the
analyzed diff. Relevant observations and teaching steps appear as AI
discussion notes and publish into the feedback bundle without removing
reviewer replies. A changed comparison invalidates an in-flight result.

Analysis passes only bounded text diff inputs to the selected provider.
Results identify omitted media, oversized changes, and files beyond the
job limit. The host reads the comparison again before publishing to catch
working-tree changes while inference was running. Latency and reuse are
tracked in `HS2-JZ6M27`.
