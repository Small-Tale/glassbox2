# Requirements summary

- [Core and local service](../core.md) is partly built. It provides the shared Rust workspace and real loopback readiness endpoint. The parity map identifies the v1 sources and linked product work.
- [Web and Tauri host](../hosting.md) serves the built web client and catalog from one local HTTP origin. The desktop shell embeds the same host. Both clients can open review sources through the shared host.
- [Application settings](../settings.md) are partly built. System, Light, and Dark are implemented in the shared workbench and persisted locally.
- [Direct comparison](../direct-comparison.md) is partly built. The core compares file pairs and directory trees. The workbench opens file and folder pairs. Media presentation is tracked separately.
- [Comparison content](../comparison-content.md) is partly built. Shared hunks and original media inputs, including local Git LFS media, are implemented. The workbench has inline and split text viewers. Original media rendering and plugins are tracked separately.
- [Review feedback](../feedback.md) has the shared thread, reply, attachment and anchor model. The disk bundle writer, quoted instruction, and Hot Sheet 2 delivery client are implemented. The inspector and handoff UI are tracked separately. Legacy Glassbox v1 SARIF import was retired in HS2-NKX7N3.
- [Git review](../git-review.md) is partly built. The core retrieves Git change metadata and patches. The CLI starts a client through Git difftool, and the shared host exposes launch paths. The workbench opens Git reviews and difftool launches and lists changed files. Text diff content is implemented. Image presentation is tracked separately.
- [UI conventions](../ui-conventions.md) are in use. The Kerf catalog ships grouped specimens for the review workbench and navigator. Source selection and the changed-file navigator are implemented. The text diff viewer ships with a catalog specimen. Review threads and the inspector are tracked in Hot Sheet.
- Hot Sheet export UI, optional AI, and cross-platform release verification are planned in the linked tickets.
- PostgreSQL, the review completion lifecycle and ground-truth image comparison are retired. Native clients and distribution decisions are deferred.
