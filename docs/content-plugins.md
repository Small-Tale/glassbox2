# Diagram renderers

Glassbox recognizes Graphviz (`.dot`, `.gv`), Mermaid (`.mmd`, `.mermaid`),
and PlantUML (`.puml`, `.plantuml`). They open as source comparisons. If the
host has an approved renderer, Render Diagram opens the available sides in
the image viewer. Show Diagram Source returns to the text diff. A failed
render keeps the text comparison open.

The thread inspector uses the same renderer for diagram attachments. Preview
shows the diagram and exposes its source. If the renderer is absent or fails,
the original UTF-8 source is shown directly. Diagram visuals use image
elements with opaque data URLs. The app does not insert renderer markup
into the workbench document.

## Renderer contract

Set `GLASSBOX_CONTENT_RENDERER` to the absolute path of a trusted executable
before starting the Glassbox host. The executable runs with the host user's
permissions. The host sends one UTF-8 JSON object to stdin and closes stdin.
The executable writes a single reply to stdout and exits. Format IDs are
`graphviz`, `mermaid`, and `plantuml`.

```json
{"version":1,"format":"graphviz","source":"digraph { a -> b }"}
```

```json
{"version":1,"outcome":{"status":"rendered","svg":"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"}}
```

For an unsupported or failed input, reply with
`{"version":1,"outcome":{"status":"unavailable"}}`. The host bounds source
content to 1 MiB, the response to 4 MiB, and each rendering process to 10
seconds. A renderer that starts additional tools owns their cancellation and
cleanup.

The host invokes the renderer on request. Git comparisons send the selected
side contents from the comparison source. For an attachment, the host checks
the review, file, thread, and attachment identity before reading the content.

Run the real-host regression with
`cargo test --locked -p glassbox-server --test http renders_selected_diagrams_and_falls_back_for_attached_sources`.
The test compiles a renderer fixture and exercises all three formats and the
attachment fallback.

## Local adapter

Build the optional adapter with
`cargo build --locked -p glassbox-render-local`. Point
`GLASSBOX_CONTENT_RENDERER` at the resulting executable in `target/debug`
(`.exe` on Windows). Set the absolute paths for the formats you use.

| Format | Configuration |
| --- | --- |
| Graphviz | `GLASSBOX_GRAPHVIZ_EXECUTABLE` points to [Graphviz dot](https://graphviz.org/doc/info/command.html). |
| Mermaid | `GLASSBOX_MERMAID_EXECUTABLE` points to [Mermaid CLI](https://github.com/mermaid-js/mermaid-cli). |
| PlantUML | `GLASSBOX_JAVA_EXECUTABLE` points to Java and `GLASSBOX_PLANTUML_JAR` points to the jar. The adapter starts PlantUML in its [SANDBOX profile](https://plantuml.com/security). |

The adapter runs each tool in a fresh temporary directory with a
seven-second deadline. It uses a process group on Unix and a job object
on Windows to clean up tools and their child processes on timeout.
Missing tools, failed commands, and oversized outputs leave source
available through the normal fallback. Configure tools from installations
you trust. Tool binaries and distribution are tracked separately from
the Glassbox adapter.

`cargo test --locked -p glassbox-render-local` exercises dispatch, bounds,
and failure handling. With the four tool paths configured, run
`cargo test --locked -p glassbox-render-local renders_real_tools -- --ignored`
to smoke test the installed engines.

The **Local diagram tools** workflow runs that smoke test on macOS, Linux,
and Windows with installed engines. The regular CI runs the adapter
fixtures on all three platforms.
