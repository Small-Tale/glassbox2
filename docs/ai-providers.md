# AI provider plugins

Glassbox uses a shared Rust provider registry and a versioned subprocess
protocol. This follows the manifest and behavioral plugin boundary in Hot
Sheet 2’s AI-tool plugin design. The protocol is available to the local host
and headless callers. Analysis and provider selection in the workbench are
tracked in `HS2-05B1PZ`.

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
