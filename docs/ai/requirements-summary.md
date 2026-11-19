# Requirements summary

- [Core and local service](../core.md) is partly built. It provides the shared Rust workspace and real loopback readiness endpoint. The parity map identifies the v1 sources and linked product work.
- [Web and Tauri host](../hosting.md) serves the built web client and catalog from one local HTTP origin. The desktop shell embeds the same host. Review flow wiring is tracked separately.
- [Application settings](../settings.md) are partly built. The shared appearance contract and file store are implemented. Client wiring and controls are tracked separately.
- [Direct comparison](../direct-comparison.md) is partly built. The core compares file pairs and directory trees. Media presentation and the UI entry point are tracked separately.
- [Comparison content](../comparison-content.md) is partly built. Shared hunks and original media inputs are implemented. The real viewer and plugin rendering are tracked separately.
- AI-generated review notes and thread replies are planned through the provider and feedback work. Legacy Glassbox v1 SARIF import was retired in HS2-NKX7N3.
- [Git review](../git-review.md) is partly built. The core retrieves Git change metadata and patches. The CLI starts a client through Git difftool, and the shared host exposes launch paths. Workbench ingestion and presentation are tracked in HS2-KGVXT8.
- [UI conventions](../ui-conventions.md) are in use. The Kerf catalog is shipped with its first grouped specimen. The shared review workbench and its catalog specimen are implemented. Source selection, diff content and the inspector are tracked in Hot Sheet.
- Git and arbitrary comparison, the CLI, file-based feedback, Hot Sheet export, optional AI, and Tauri integration are planned in the linked tickets.
- PostgreSQL, the review completion lifecycle and ground-truth image comparison are retired. Native clients and distribution decisions are deferred.
