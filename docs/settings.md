# Application settings

Glassbox stores application-wide preferences in `~/.glassbox2/settings.json`,
where `~` is the home directory resolved for the current OS account. The
shared `ApplicationSettings` model supports the appearance values `system`,
`light`, and `dark`. The default is `system`. The browser and Tauri use the same store.
Choose System, Light, or Dark in the Appearance menu in the workbench
footer (`HS2-9T7RCB`). System follows OS changes without a reload.

The file stores the model fields with a numeric `version` of 1. An absent
file yields defaults. Unversioned or version-zero documents are read and
upgraded on the next save. Unknown fields survive a save. Malformed JSON,
invalid appearance values, and unsupported future versions are reported
and preserved.

Saves create a private temporary file in the settings directory, sync its
contents, then atomically replace the settings file. Clients coordinate reads
and saves through a persistent `.settings.lock` file in the same directory.
Readers see a complete snapshot. Concurrent saves of appearance use the last
successful replacement.

The host reads settings from `GET /api/v1/settings`. A `PUT` with an
explicit `appearance` value persists it. The client applies changes
immediately and restores the last saved choice if a write fails.
The host accepts `GLASSBOX_SETTINGS_DIRECTORY` to use a separate store,
including during isolated desktop and browser verification.

The workbench footer’s **AI Settings** action saves a provider, a model choice,
and Code Guidance topics in the same file (`HS2-ZVZGNM`). These fields and
appearance are updated independently using the shared lock. Before a choice
is saved, the host's launch configuration supplies the default. Selecting
Disabled explicitly overrides a launch default. The dialog loads the model
list only when requested and displays the approved executable that receives
analysis input. See [AI providers](ai-providers.md#optional-review-analysis)
for the host approval boundary and cache behavior.
