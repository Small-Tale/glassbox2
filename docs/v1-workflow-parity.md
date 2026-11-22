# Glassbox v1 workflow parity

The remaining v1 workflows were audited in `HS2-8B3QNX`. The source
paths below refer to the Glassbox v1 repository.

| Workflow                | v1 reference                        | v2 decision                                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Symbol navigation       | `docs/13-navigation.md`             | [Git-side definition jumps and navigation history](symbol-navigation.md) support Rust and TypeScript (`HS2-HQCQXH`). Additional languages are tracked in `HS2-8BVWYT` and AI note source links in `HS2-VES1BF`.                                               |
| Editor and file manager | `docs/21-sidebar-context-menu.md`   | Carry forward open, reveal and relative or absolute path copy in `HS2-TWT58G`. Resolve the selected entry through the shared host and handle historical views and temporary Git paths explicitly.                                                            |
| Claude Channel          | `docs/17-claude-channel.md`         | Deliver feedback through the Hot Sheet 2 connection or a copied AI instruction. Both use the [durable feedback bundle](feedback.md) throughout the review.                                                                                                   |
| Project Git ignore      | `docs/27-gitignore.md`              | Retire the automatic Git ignore edit. Glassbox writes [settings](settings.md) and [feedback](feedback.md) in user data. Git's ignore rules govern untracked repository entries. [Direct folder comparisons](direct-comparison.md) compare all input entries. |
| Plugin lifecycle        | `docs/31-plugin-lifecycle-hooks.md` | Scope plugin behavior to declared analysis and rendering capabilities in `HS2-QHTFTW` and `HS2-YY5JYG`. The generic creation and completion hooks retire with the old review lifecycle.                                                                      |
| Legacy data             | `docs/9-data-storage.md`            | Continue to read old review data through Glassbox v1 and its existing exports. Glassbox v2 starts with local file bundles and its own settings.                                                                                                              |

Ground-truth image comparison, PostgreSQL and the finish-review workflow
are retired. Ordinary image comparison remains tracked in `HS2-B9NHFE`.
