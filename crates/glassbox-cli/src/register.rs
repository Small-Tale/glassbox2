//! Register Glassbox as the default Git difftool, or remove it again (HS2-HVP8Q1).
//!
//! Registration edits one Git configuration scope that the person names, never both. It sets
//! the tool entry Glassbox documents, makes it the scope's `diff.tool`, and remembers the
//! default it replaced so unregistering can put it back. Unregistering only changes what it can
//! show is still Glassbox's: a default another tool or person has since chosen is left alone.

use std::ffi::OsString;
use std::io;
use std::process::Command;

/// The command Git runs for the tool; the same entry `docs/git-review.md` documents.
pub const REGISTERED_COMMAND: &str = r#"glassbox-cli --git-difftool "$LOCAL" "$REMOTE""#;

const TOOL: &str = "glassbox";
const DEFAULT_KEY: &str = "diff.tool";
const COMMAND_KEY: &str = "difftool.glassbox.cmd";
const PREVIOUS_KEY: &str = "difftool.glassbox.previousDefault";
const SECTION: &str = "difftool.glassbox";

const REGISTER_OPTION: &str = "--register-git-difftool";
const UNREGISTER_OPTION: &str = "--unregister-git-difftool";
const USAGE: &str = "usage: glassbox-cli --register-git-difftool|--unregister-git-difftool \
                     --global|--local";

/// The Git configuration file a registration reads and writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scope {
    /// The person's own configuration, used by every repository.
    Global,
    /// The current repository's configuration only.
    Local,
}

impl Scope {
    fn flag(self) -> &'static str {
        match self {
            Self::Global => "--global",
            Self::Local => "--local",
        }
    }

    fn describe(self) -> &'static str {
        match self {
            Self::Global => "global Git configuration (every repository for this user)",
            Self::Local => "local Git configuration (this repository only)",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Request {
    Register(Scope),
    Unregister(Scope),
}

/// Recognise a registration request. `None` means the arguments are for `git difftool`.
pub fn parse(args: &[OsString]) -> Option<io::Result<Request>> {
    let first = args.first()?;
    let register = if first == REGISTER_OPTION {
        true
    } else if first == UNREGISTER_OPTION {
        false
    } else {
        return None;
    };
    let scope = match args {
        [_, scope] if scope == "--global" => Scope::Global,
        [_, scope] if scope == "--local" => Scope::Local,
        _ => return Some(Err(invalid(USAGE.to_owned()))),
    };
    Some(Ok(if register {
        Request::Register(scope)
    } else {
        Request::Unregister(scope)
    }))
}

fn invalid(message: String) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

/// The Git configuration operations registration needs, so its decisions can be tested without
/// touching a real configuration file.
pub trait Config {
    fn get(&self, key: &str) -> io::Result<Option<String>>;
    fn set(&mut self, key: &str, value: &str) -> io::Result<()>;
    /// Remove a key; a key that is not set is not an error.
    fn unset(&mut self, key: &str) -> io::Result<()>;
    fn section_has_keys(&self, section: &str) -> io::Result<bool>;
    fn remove_section(&mut self, section: &str) -> io::Result<()>;
}

/// Run a registration request against Git's real configuration and return the report lines.
pub fn execute(request: &Request) -> io::Result<Vec<String>> {
    match *request {
        Request::Register(scope) => register(&mut GitConfig { scope }, scope),
        Request::Unregister(scope) => unregister(&mut GitConfig { scope }, scope),
    }
}

pub fn register(config: &mut impl Config, scope: Scope) -> io::Result<Vec<String>> {
    if let Some(command) = config.get(COMMAND_KEY)? {
        if command != REGISTERED_COMMAND {
            return Err(invalid(format!(
                "{COMMAND_KEY} is already set to `{command}` in the {}; leave it, or remove it \
                 with `git config {} --unset {COMMAND_KEY}` and register again",
                scope.describe(),
                scope.flag()
            )));
        }
    }
    let current = config.get(DEFAULT_KEY)?;
    let mut report = Vec::new();
    // The tool entry goes in first so the default never names a tool Git cannot run.
    config.set(COMMAND_KEY, REGISTERED_COMMAND)?;
    match current.as_deref() {
        Some(TOOL) => report.push(format!(
            "Glassbox was already the default Git difftool in the {}.",
            scope.describe()
        )),
        Some(previous) => {
            config.set(PREVIOUS_KEY, previous)?;
            config.set(DEFAULT_KEY, TOOL)?;
            report.push(format!(
                "Registered Glassbox as the default Git difftool in the {}. The previous \
                 default, `{previous}`, is saved and returns when you unregister.",
                scope.describe()
            ));
        }
        None => {
            config.unset(PREVIOUS_KEY)?;
            config.set(DEFAULT_KEY, TOOL)?;
            report.push(format!(
                "Registered Glassbox as the default Git difftool in the {}.",
                scope.describe()
            ));
        }
    }
    Ok(report)
}

pub fn unregister(config: &mut impl Config, scope: Scope) -> io::Result<Vec<String>> {
    let current = config.get(DEFAULT_KEY)?;
    let command = config.get(COMMAND_KEY)?;
    let previous = config.get(PREVIOUS_KEY)?;
    let mut report = Vec::new();
    let mut changed = false;
    match current.as_deref() {
        Some(TOOL) => {
            match &previous {
                Some(previous) => {
                    config.set(DEFAULT_KEY, previous)?;
                    report.push(format!(
                        "Restored `{previous}` as the default Git difftool."
                    ));
                }
                None => {
                    config.unset(DEFAULT_KEY)?;
                    report.push("Removed Glassbox as the default Git difftool.".to_owned());
                }
            }
            config.unset(PREVIOUS_KEY)?;
            changed = true;
        }
        // Only worth saying while something of Glassbox's is still there to remove.
        Some(other) if command.is_some() || previous.is_some() => report.push(format!(
            "The default Git difftool is `{other}`, not Glassbox, so it was left unchanged."
        )),
        Some(_) | None => {}
    }
    match command.as_deref() {
        Some(REGISTERED_COMMAND) => {
            config.unset(COMMAND_KEY)?;
            config.unset(PREVIOUS_KEY)?;
            if !config.section_has_keys(SECTION)? {
                config.remove_section(SECTION)?;
            }
            report.push("Removed the Glassbox tool entry.".to_owned());
            changed = true;
        }
        Some(other) => report.push(format!(
            "{COMMAND_KEY} is `{other}`, which Glassbox did not write, so it was left unchanged."
        )),
        None => {}
    }
    if !changed && report.is_empty() {
        report.push("Glassbox was not registered, so nothing changed.".to_owned());
    }
    report.insert(0, format!("Scope: {}.", scope.describe()));
    Ok(report)
}

/// `git config` for one scope.
struct GitConfig {
    scope: Scope,
}

impl GitConfig {
    fn run(&self, args: &[&str]) -> io::Result<std::process::Output> {
        Command::new("git")
            .arg("config")
            .arg(self.scope.flag())
            .args(args)
            .output()
            .map_err(|error| io::Error::new(error.kind(), format!("run git: {error}")))
    }

    fn fail(&self, output: &std::process::Output) -> io::Error {
        io::Error::other(format!(
            "git config {} failed: {}",
            self.scope.flag(),
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

impl Config for GitConfig {
    fn get(&self, key: &str) -> io::Result<Option<String>> {
        let output = self.run(&["--get", key])?;
        match output.status.code() {
            Some(0) => Ok(Some(
                String::from_utf8_lossy(&output.stdout)
                    .trim_end_matches(['\r', '\n'])
                    .to_owned(),
            )),
            Some(1) => Ok(None),
            _ => Err(self.fail(&output)),
        }
    }

    fn set(&mut self, key: &str, value: &str) -> io::Result<()> {
        let output = self.run(&[key, value])?;
        if output.status.success() {
            Ok(())
        } else {
            Err(self.fail(&output))
        }
    }

    fn unset(&mut self, key: &str) -> io::Result<()> {
        let output = self.run(&["--unset", key])?;
        match output.status.code() {
            Some(0 | 5) => Ok(()),
            _ => Err(self.fail(&output)),
        }
    }

    fn section_has_keys(&self, section: &str) -> io::Result<bool> {
        let pattern = format!("^{}\\.", section.replace('.', "\\."));
        let output = self.run(&["--get-regexp", &pattern])?;
        match output.status.code() {
            Some(0) => Ok(true),
            Some(1) => Ok(false),
            _ => Err(self.fail(&output)),
        }
    }

    fn remove_section(&mut self, section: &str) -> io::Result<()> {
        let output = self.run(&["--remove-section", section])?;
        if output.status.success()
            || String::from_utf8_lossy(&output.stderr).contains("no such section")
        {
            Ok(())
        } else {
            Err(self.fail(&output))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[derive(Default)]
    struct Memory(BTreeMap<String, String>);

    impl Memory {
        fn with(entries: &[(&str, &str)]) -> Self {
            Self(
                entries
                    .iter()
                    .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                    .collect(),
            )
        }

        fn value(&self, key: &str) -> Option<&str> {
            self.0.get(key).map(String::as_str)
        }
    }

    impl Config for Memory {
        fn get(&self, key: &str) -> io::Result<Option<String>> {
            Ok(self.0.get(key).cloned())
        }
        fn set(&mut self, key: &str, value: &str) -> io::Result<()> {
            self.0.insert(key.to_owned(), value.to_owned());
            Ok(())
        }
        fn unset(&mut self, key: &str) -> io::Result<()> {
            self.0.remove(key);
            Ok(())
        }
        fn section_has_keys(&self, section: &str) -> io::Result<bool> {
            Ok(self
                .0
                .keys()
                .any(|key| key.starts_with(&format!("{section}."))))
        }
        fn remove_section(&mut self, section: &str) -> io::Result<()> {
            self.0
                .retain(|key, _| !key.starts_with(&format!("{section}.")));
            Ok(())
        }
    }

    fn args(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn only_the_two_explicit_options_with_an_explicit_scope_are_requests() {
        assert_eq!(
            parse(&args(&["--register-git-difftool", "--global"]))
                .unwrap()
                .unwrap(),
            Request::Register(Scope::Global)
        );
        assert_eq!(
            parse(&args(&["--unregister-git-difftool", "--local"]))
                .unwrap()
                .unwrap(),
            Request::Unregister(Scope::Local)
        );
        for invalid in [
            &["--register-git-difftool"][..],
            &["--register-git-difftool", "--system"],
            &["--unregister-git-difftool", "--global", "--local"],
            &["--register-git-difftool", "global"],
        ] {
            let error = parse(&args(invalid)).unwrap().unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{invalid:?}");
            assert!(error.to_string().starts_with("usage:"));
        }
        for passthrough in [
            &[][..],
            &["HEAD"],
            &["--no-prompt", "--register-git-difftool"],
        ] {
            assert!(parse(&args(passthrough)).is_none(), "{passthrough:?}");
        }
    }

    #[test]
    fn registering_sets_the_tool_and_default_and_keeps_other_settings() {
        let mut config = Memory::with(&[("user.name", "Fixture"), ("difftool.prompt", "true")]);
        let report = register(&mut config, Scope::Global).unwrap();
        assert_eq!(config.value("diff.tool"), Some("glassbox"));
        assert_eq!(
            config.value("difftool.glassbox.cmd"),
            Some(REGISTERED_COMMAND)
        );
        assert_eq!(config.value("difftool.glassbox.previousDefault"), None);
        assert_eq!(config.value("user.name"), Some("Fixture"));
        assert_eq!(config.value("difftool.prompt"), Some("true"));
        assert!(report[0].contains("global Git configuration"));
    }

    #[test]
    fn registering_saves_a_different_default_and_repeating_keeps_that_saved_value() {
        let mut config = Memory::with(&[("diff.tool", "vimdiff")]);
        register(&mut config, Scope::Local).unwrap();
        assert_eq!(
            config.value("difftool.glassbox.previousDefault"),
            Some("vimdiff")
        );
        let report = register(&mut config, Scope::Local).unwrap();
        assert!(report[0].contains("already the default"));
        assert_eq!(
            config.value("difftool.glassbox.previousDefault"),
            Some("vimdiff")
        );
        assert_eq!(config.value("diff.tool"), Some("glassbox"));
    }

    #[test]
    fn registering_clears_a_stale_saved_default_when_none_was_set() {
        let mut config = Memory::with(&[("difftool.glassbox.previousDefault", "old")]);
        register(&mut config, Scope::Global).unwrap();
        assert_eq!(config.value("difftool.glassbox.previousDefault"), None);
    }

    #[test]
    fn registering_refuses_to_overwrite_a_different_tool_command() {
        let mut config = Memory::with(&[
            ("difftool.glassbox.cmd", "my-wrapper \"$LOCAL\""),
            ("diff.tool", "vimdiff"),
        ]);
        let error = register(&mut config, Scope::Global).unwrap_err();
        assert!(error.to_string().contains("my-wrapper"));
        assert_eq!(config.value("diff.tool"), Some("vimdiff"));
        assert_eq!(
            config.value("difftool.glassbox.cmd"),
            Some("my-wrapper \"$LOCAL\"")
        );
    }

    #[test]
    fn unregistering_restores_the_previous_default_and_removes_only_glassbox_entries() {
        let mut config = Memory::with(&[("diff.tool", "vimdiff"), ("user.name", "Fixture")]);
        register(&mut config, Scope::Global).unwrap();
        config.set("difftool.other.cmd", "other").unwrap();
        let report = unregister(&mut config, Scope::Global).unwrap();
        assert_eq!(config.value("diff.tool"), Some("vimdiff"));
        assert!(!config.section_has_keys("difftool.glassbox").unwrap());
        assert_eq!(config.value("difftool.other.cmd"), Some("other"));
        assert_eq!(config.value("user.name"), Some("Fixture"));
        assert!(
            report
                .iter()
                .any(|line| line.contains("Restored `vimdiff`"))
        );
    }

    #[test]
    fn unregistering_with_no_previous_default_unsets_it() {
        let mut config = Memory::default();
        register(&mut config, Scope::Global).unwrap();
        unregister(&mut config, Scope::Global).unwrap();
        assert!(config.0.is_empty(), "{:?}", config.0);
    }

    #[test]
    fn unregistering_leaves_a_default_someone_else_chose_since() {
        let mut config = Memory::with(&[("diff.tool", "vimdiff")]);
        register(&mut config, Scope::Global).unwrap();
        config.set("diff.tool", "meld").unwrap();
        let report = unregister(&mut config, Scope::Global).unwrap();
        assert_eq!(config.value("diff.tool"), Some("meld"));
        assert!(!config.section_has_keys("difftool.glassbox").unwrap());
        assert!(
            report
                .iter()
                .any(|line| line.contains("`meld`, not Glassbox"))
        );
    }

    #[test]
    fn unregistering_keeps_a_tool_command_glassbox_did_not_write() {
        let mut config = Memory::with(&[
            ("diff.tool", "glassbox"),
            ("difftool.glassbox.cmd", "custom"),
        ]);
        unregister(&mut config, Scope::Global).unwrap();
        assert_eq!(config.value("diff.tool"), None);
        assert_eq!(config.value("difftool.glassbox.cmd"), Some("custom"));
    }

    #[test]
    fn unregistering_when_nothing_is_registered_succeeds_and_changes_nothing() {
        let mut config = Memory::with(&[("user.name", "Fixture")]);
        let report = unregister(&mut config, Scope::Local).unwrap();
        assert!(report.iter().any(|line| line.contains("not registered")));
        assert_eq!(config.0.len(), 1);
    }

    #[test]
    fn register_then_unregister_round_trips_from_every_starting_default() {
        for start in [None, Some("vimdiff"), Some("glassbox")] {
            let mut config = Memory::default();
            if let Some(tool) = start {
                config.set("diff.tool", tool).unwrap();
            }
            let before = config.0.clone();
            register(&mut config, Scope::Global).unwrap();
            register(&mut config, Scope::Global).unwrap();
            unregister(&mut config, Scope::Global).unwrap();
            if start == Some("glassbox") {
                // A default that was already Glassbox has no earlier value to restore.
                assert!(config.value("diff.tool").is_none());
            } else {
                assert_eq!(config.0, before, "{start:?}");
            }
        }
    }
}
