# Application settings

Glassbox stores application-wide preferences in `~/.glassbox2/settings.json`,
where `~` is the home directory resolved for the current OS account. The
shared `ApplicationSettings` model supports the appearance values `system`,
`light`, and `dark`. The default is `system`. Tauri and web hosting will
use the same model under `HS2-4PZVQG` and `HS2-9T7RCB`.

The file stores the model fields with a numeric `version` of 1. An absent
file yields defaults. Unversioned or version-zero documents are read and
upgraded on the next save. Unknown fields survive a save. Malformed JSON,
invalid appearance values, and unsupported future versions are reported
and preserved.

Saves create a private temporary file in the settings directory, sync its
contents, then atomically replace the settings file. Readers see a complete
snapshot. Concurrent saves of appearance use the last successful replacement.
