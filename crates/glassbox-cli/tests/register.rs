//! HS2-HVP8Q1: registering Glassbox as the default Git difftool, against real Git and the real
//! `glassbox-cli` binary. Every command runs with an isolated global configuration.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

struct Sandbox {
    _scratch: tempfile::TempDir,
    root: PathBuf,
    global: PathBuf,
    home: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let scratch = tempfile::tempdir().unwrap();
        let root = scratch.path().join("repo with spaces");
        let home = scratch.path().join("home");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&home).unwrap();
        let global = scratch.path().join("global gitconfig");
        let sandbox = Self {
            _scratch: scratch,
            root,
            global,
            home,
        };
        sandbox.git(&["init", "-q", "--initial-branch=main"]);
        sandbox.git(&["config", "--local", "user.email", "fixture@example.invalid"]);
        sandbox.git(&["config", "--local", "user.name", "Fixture"]);
        sandbox.git(&["config", "--local", "core.autocrlf", "false"]);
        sandbox
    }

    fn command(&self, program: impl AsRef<std::ffi::OsStr>) -> Command {
        let mut command = Command::new(program);
        command
            .current_dir(&self.root)
            .env("GIT_CONFIG_GLOBAL", &self.global)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("HOME", &self.home)
            .env("USERPROFILE", &self.home)
            .env("XDG_CONFIG_HOME", self.home.join("xdg"));
        command
    }

    fn git(&self, args: &[&str]) -> Output {
        let output = self.command("git").args(args).output().unwrap();
        assert!(
            output.status.success(),
            "{args:?}: {}",
            text(&output.stderr)
        );
        output
    }

    fn cli(&self, args: &[&str]) -> Output {
        self.command(env!("CARGO_BIN_EXE_glassbox-cli"))
            .args(args)
            .output()
            .unwrap()
    }

    fn value(&self, scope: &str, key: &str) -> Option<String> {
        let output = self
            .command("git")
            .args(["config", scope, "--get", key])
            .output()
            .unwrap();
        output
            .status
            .success()
            .then(|| text(&output.stdout).trim().to_owned())
    }

    fn global_file(&self) -> String {
        fs::read_to_string(&self.global).unwrap_or_default()
    }
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn ok(output: &Output) -> String {
    assert!(
        output.status.success(),
        "{}\n{}",
        text(&output.stdout),
        text(&output.stderr)
    );
    text(&output.stdout)
}

const COMMAND: &str = r#"GLASSBOX_DIFFTOOL_SESSION="$PPID" GLASSBOX_DIFFTOOL_PATH="$MERGED" glassbox-cli --git-difftool "$LOCAL" "$REMOTE""#;
/// What earlier versions registered (GB2-FXJSSM).
const LEGACY_COMMAND: &str = r#"glassbox-cli --git-difftool "$LOCAL" "$REMOTE""#;

#[test]
fn registering_twice_writes_one_global_entry_and_keeps_unrelated_settings() {
    let sandbox = Sandbox::new();
    sandbox.git(&["config", "--global", "user.name", "Someone Else"]);
    sandbox.git(&["config", "--global", "difftool.prompt", "true"]);
    sandbox.git(&["config", "--global", "difftool.meld.cmd", "meld \"$LOCAL\""]);

    let first = ok(&sandbox.cli(&["--register-git-difftool", "--global"]));
    assert!(first.contains("global Git configuration"), "{first}");
    let after_first = sandbox.global_file();
    let again = ok(&sandbox.cli(&["--register-git-difftool", "--global"]));
    assert!(again.contains("already the default"), "{again}");
    assert_eq!(
        sandbox.global_file(),
        after_first,
        "repeat registration rewrote the file"
    );

    assert_eq!(
        sandbox.value("--global", "diff.tool").as_deref(),
        Some("glassbox")
    );
    assert_eq!(
        sandbox
            .value("--global", "difftool.glassbox.cmd")
            .as_deref(),
        Some(COMMAND)
    );
    assert_eq!(
        sandbox.value("--global", "user.name").as_deref(),
        Some("Someone Else")
    );
    assert_eq!(
        sandbox.value("--global", "difftool.prompt").as_deref(),
        Some("true")
    );
    assert_eq!(
        sandbox.value("--global", "difftool.meld.cmd").as_deref(),
        Some("meld \"$LOCAL\"")
    );
    // The scope was explicit: the repository's own configuration is untouched.
    assert_eq!(sandbox.value("--local", "diff.tool"), None);
}

#[test]
fn unregistering_restores_the_previous_default_and_removes_only_glassbox_entries() {
    let sandbox = Sandbox::new();
    sandbox.git(&["config", "--global", "diff.tool", "vimdiff"]);
    sandbox.git(&["config", "--global", "user.name", "Someone Else"]);
    ok(&sandbox.cli(&["--register-git-difftool", "--global"]));
    assert_eq!(
        sandbox
            .value("--global", "difftool.glassbox.previousDefault")
            .as_deref(),
        Some("vimdiff")
    );

    let report = ok(&sandbox.cli(&["--unregister-git-difftool", "--global"]));
    assert!(report.contains("Restored `vimdiff`"), "{report}");
    assert_eq!(
        sandbox.value("--global", "diff.tool").as_deref(),
        Some("vimdiff")
    );
    assert_eq!(
        sandbox.value("--global", "user.name").as_deref(),
        Some("Someone Else")
    );
    assert!(
        !sandbox.global_file().contains("glassbox"),
        "{}",
        sandbox.global_file()
    );

    let again = ok(&sandbox.cli(&["--unregister-git-difftool", "--global"]));
    assert!(again.contains("not registered"), "{again}");
    assert_eq!(
        sandbox.value("--global", "diff.tool").as_deref(),
        Some("vimdiff")
    );
}

#[test]
fn unregistering_never_undoes_a_default_changed_since_registration() {
    let sandbox = Sandbox::new();
    ok(&sandbox.cli(&["--register-git-difftool", "--global"]));
    sandbox.git(&["config", "--global", "diff.tool", "meld"]);
    let report = ok(&sandbox.cli(&["--unregister-git-difftool", "--global"]));
    assert!(report.contains("`meld`, not Glassbox"), "{report}");
    assert_eq!(
        sandbox.value("--global", "diff.tool").as_deref(),
        Some("meld")
    );
    assert_eq!(sandbox.value("--global", "difftool.glassbox.cmd"), None);
}

#[test]
fn local_scope_changes_only_the_repository_and_global_scope_stays_untouched() {
    let sandbox = Sandbox::new();
    sandbox.git(&["config", "--global", "diff.tool", "vimdiff"]);
    ok(&sandbox.cli(&["--register-git-difftool", "--local"]));
    assert_eq!(
        sandbox.value("--local", "diff.tool").as_deref(),
        Some("glassbox")
    );
    assert_eq!(
        sandbox.value("--global", "diff.tool").as_deref(),
        Some("vimdiff")
    );
    assert!(!sandbox.global_file().contains("glassbox"));
    ok(&sandbox.cli(&["--unregister-git-difftool", "--local"]));
    assert_eq!(sandbox.value("--local", "diff.tool"), None);
    assert_eq!(
        sandbox.value("--global", "diff.tool").as_deref(),
        Some("vimdiff")
    );
}

#[test]
fn registration_needs_an_explicit_scope_a_repository_for_local_and_a_free_tool_name() {
    let sandbox = Sandbox::new();
    for args in [
        &["--register-git-difftool"][..],
        &["--register-git-difftool", "--system"],
        &["--unregister-git-difftool", "--global", "--local"],
    ] {
        let output = sandbox.cli(args);
        assert!(!output.status.success(), "{args:?}");
        assert!(text(&output.stderr).contains("usage:"), "{args:?}");
    }
    assert_eq!(sandbox.value("--global", "diff.tool"), None);

    // `--local` outside a repository is Git's error, reported and nothing is written.
    let outside = sandbox._scratch.path().join("not a repository");
    fs::create_dir_all(&outside).unwrap();
    let output = sandbox
        .command(env!("CARGO_BIN_EXE_glassbox-cli"))
        .current_dir(&outside)
        .env("GIT_CEILING_DIRECTORIES", sandbox._scratch.path())
        .args(["--register-git-difftool", "--local"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        text(&output.stderr).contains("git config --local failed"),
        "{}",
        text(&output.stderr)
    );

    // A tool entry named glassbox that someone else wrote is never overwritten.
    sandbox.git(&["config", "--global", "diff.tool", "vimdiff"]);
    sandbox.git(&[
        "config",
        "--global",
        "difftool.glassbox.cmd",
        "my-wrapper \"$LOCAL\"",
    ]);
    let output = sandbox.cli(&["--register-git-difftool", "--global"]);
    assert!(!output.status.success());
    assert!(
        text(&output.stderr).contains("my-wrapper"),
        "{}",
        text(&output.stderr)
    );
    assert_eq!(
        sandbox.value("--global", "diff.tool").as_deref(),
        Some("vimdiff")
    );
}

fn fixture_client(dir: &Path) -> PathBuf {
    let source = dir.join("client.rs");
    fs::write(
        &source,
        r#"
use std::{env, fs, io::Write, path::PathBuf};
fn main() {
    let args: Vec<_> = env::args_os().skip(1).collect();
    assert_eq!(args.len(), 3);
    assert_eq!(args[0], "--difftool");
    let output = env::var_os("DIFFTOOL_TEST_OUTPUT").map(PathBuf::from).unwrap();
    let mut record = fs::OpenOptions::new().append(true).create(true).open(output).unwrap();
    record.write_all(&fs::read(&args[1]).unwrap()).unwrap();
    record.write_all(&fs::read(&args[2]).unwrap()).unwrap();
    if env::var_os("DIFFTOOL_TEST_FAIL").is_some() {
        std::process::exit(7);
    }
}
"#,
    )
    .unwrap();
    let binary = dir.join(format!("client{}", env::consts::EXE_SUFFIX));
    let built = Command::new("rustc")
        .arg(&source)
        .arg("-o")
        .arg(&binary)
        .output()
        .unwrap();
    assert!(built.status.success(), "{}", text(&built.stderr));
    binary
}

#[test]
fn plain_git_difftool_launches_glassbox_once_registered_and_stops_after_unregistering() {
    let sandbox = Sandbox::new();
    fs::write(sandbox.root.join("a.txt"), "old\n").unwrap();
    sandbox.git(&["add", "."]);
    sandbox.git(&["commit", "-qm", "initial"]);
    fs::write(sandbox.root.join("a.txt"), "new\n").unwrap();
    let client = fixture_client(sandbox._scratch.path());
    let record = sandbox._scratch.path().join("record");
    let cli_dir = Path::new(env!("CARGO_BIN_EXE_glassbox-cli"))
        .parent()
        .unwrap();
    let path = env::join_paths(
        std::iter::once(cli_dir.to_path_buf())
            .chain(env::split_paths(&env::var_os("PATH").unwrap())),
    )
    .unwrap();
    let difftool = |fail: bool, trust: bool| {
        let _ = fs::remove_file(&record);
        let mut command = sandbox.command("git");
        command
            .env("PATH", &path)
            .env("GLASSBOX_DIFFTOOL_CLIENT", &client)
            .env("DIFFTOOL_TEST_OUTPUT", &record)
            .args(["difftool", "--no-prompt"])
            .args(trust.then_some("--trust-exit-code"))
            .args(["--", "a.txt"]);
        if fail {
            command.env("DIFFTOOL_TEST_FAIL", "1");
        }
        command.output().unwrap()
    };

    ok(&sandbox.cli(&["--register-git-difftool", "--global"]));
    ok(&difftool(false, false));
    assert_eq!(fs::read_to_string(&record).unwrap(), "old\nnew\n");
    // Git's own `--trust-exit-code` reports a client failure; registration never sets the global
    // `difftool.trustExitCode`, which would change every other tool.
    assert!(!difftool(true, true).status.success());
    assert!(difftool(true, false).status.success());
    assert_eq!(sandbox.value("--global", "difftool.trustExitCode"), None);

    ok(&sandbox.cli(&["--unregister-git-difftool", "--global"]));
    // Name the tool instead of letting Git pick a default, which could start an interactive tool.
    let _ = fs::remove_file(&record);
    let unregistered = sandbox
        .command("git")
        .env("PATH", &path)
        .env("GLASSBOX_DIFFTOOL_CLIENT", &client)
        .env("DIFFTOOL_TEST_OUTPUT", &record)
        .args(["difftool", "--no-prompt", "--tool=glassbox", "--", "a.txt"])
        .output()
        .unwrap();
    assert!(
        !unregistered.status.success(),
        "Git still ran a glassbox tool after unregistering"
    );
    assert!(
        !record.exists(),
        "Glassbox launched after it was unregistered"
    );
    assert_eq!(sandbox.value("--global", "diff.tool"), None);
}

#[test]
fn an_earlier_registration_is_updated_in_place_and_still_unregisters() {
    // GB2-FXJSSM: the old per-file command is still Glassbox's entry.
    let sandbox = Sandbox::new();
    sandbox.git(&[
        "config",
        "--global",
        "difftool.glassbox.cmd",
        LEGACY_COMMAND,
    ]);
    sandbox.git(&["config", "--global", "diff.tool", "glassbox"]);
    let report = ok(&sandbox.cli(&["--register-git-difftool", "--global"]));
    assert!(
        report.contains("Updated the Glassbox tool entry"),
        "{report}"
    );
    assert_eq!(
        sandbox
            .value("--global", "difftool.glassbox.cmd")
            .as_deref(),
        Some(COMMAND)
    );
    let again = ok(&sandbox.cli(&["--register-git-difftool", "--global"]));
    assert!(
        !again.contains("Updated"),
        "a current entry is not rewritten: {again}"
    );

    sandbox.git(&[
        "config",
        "--global",
        "difftool.glassbox.cmd",
        LEGACY_COMMAND,
    ]);
    let removed = ok(&sandbox.cli(&["--unregister-git-difftool", "--global"]));
    assert!(
        removed.contains("Removed the Glassbox tool entry"),
        "{removed}"
    );
    assert_eq!(sandbox.value("--global", "difftool.glassbox.cmd"), None);
}

/// A client that records one line per launch: `file|before>after`, or for a directory pair `dir|` and then
/// `path=before>after` entries separated by `;` (`-` for a side that does not exist), sorted by path.
fn recording_client(dir: &Path) -> PathBuf {
    let source = dir.join("recording.rs");
    fs::write(
        &source,
        r#"
use std::{env, fs, io::Write, path::{Path, PathBuf}};
fn side(path: &Path) -> String {
    fs::read_to_string(path).map(|text| text.trim().to_owned()).unwrap_or_else(|_| "-".into())
}
fn files(root: &Path, relative: &Path, found: &mut Vec<String>) {
    for entry in fs::read_dir(root.join(relative)).unwrap() {
        let relative = relative.join(entry.unwrap().file_name());
        if root.join(&relative).is_dir() {
            files(root, &relative, found);
        } else {
            found.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
}
fn main() {
    let args: Vec<_> = env::args_os().skip(1).collect();
    assert_eq!(args[0], "--difftool");
    let (before, after) = (PathBuf::from(&args[1]), PathBuf::from(&args[2]));
    let line = if before.is_dir() && after.is_dir() {
        let mut paths = Vec::new();
        files(&before, Path::new(""), &mut paths);
        files(&after, Path::new(""), &mut paths);
        paths.sort();
        paths.dedup();
        let entries: Vec<_> = paths
            .iter()
            .map(|path| format!("{path}={}>{}", side(&before.join(path)), side(&after.join(path))))
            .collect();
        format!("dir|{}\n", entries.join(";"))
    } else {
        format!("file|{}>{}\n", side(&before), side(&after))
    };
    let output = env::var_os("DIFFTOOL_TEST_OUTPUT").map(PathBuf::from).unwrap();
    let mut record = fs::OpenOptions::new().append(true).create(true).open(output).unwrap();
    record.write_all(line.as_bytes()).unwrap();
    if let Some(wait) = env::var_os("DIFFTOOL_TEST_WAIT") {
        std::thread::sleep(std::time::Duration::from_millis(wait.to_string_lossy().parse().unwrap()));
    }
}
"#,
    )
    .unwrap();
    let binary = dir.join(format!("recording{}", env::consts::EXE_SUFFIX));
    let built = Command::new("rustc")
        .arg(&source)
        .arg("-o")
        .arg(&binary)
        .output()
        .unwrap();
    assert!(built.status.success(), "{}", text(&built.stderr));
    binary
}

#[test]
fn one_plain_git_difftool_run_opens_one_review_and_separate_runs_stay_separate() {
    // GB2-FXJSSM
    let sandbox = Sandbox::new();
    let (nested, deleted) = ("sub folder/b & c.txt", "gone.txt");
    fs::create_dir_all(sandbox.root.join("sub folder")).unwrap();
    for (name, text) in [
        ("a.txt", "old a"),
        (nested, "old b"),
        (deleted, "old gone"),
        ("keep.txt", "same"),
    ] {
        fs::write(sandbox.root.join(name), format!("{text}\n")).unwrap();
    }
    sandbox.git(&["add", "."]);
    sandbox.git(&["commit", "-qm", "initial"]);
    fs::write(sandbox.root.join("a.txt"), "new a\n").unwrap();
    fs::write(sandbox.root.join(nested), "new b\n").unwrap();
    fs::remove_file(sandbox.root.join(deleted)).unwrap();
    fs::write(sandbox.root.join("added.txt"), "new added\n").unwrap();
    sandbox.git(&["add", "-A"]);
    let client = recording_client(sandbox._scratch.path());
    let record = sandbox._scratch.path().join("record");
    let cli_dir = Path::new(env!("CARGO_BIN_EXE_glassbox-cli"))
        .parent()
        .unwrap();
    let path = env::join_paths(
        std::iter::once(cli_dir.to_path_buf())
            .chain(env::split_paths(&env::var_os("PATH").unwrap())),
    )
    .unwrap();
    let staging = sandbox._scratch.path().join("staging");
    fs::create_dir_all(&staging).unwrap();
    let run = |extra: &[&str], wait: &str| {
        let mut command = sandbox.command("git");
        command
            .env("PATH", &path)
            .env("GLASSBOX_DIFFTOOL_CLIENT", &client)
            .env("DIFFTOOL_TEST_OUTPUT", &record)
            .env("DIFFTOOL_TEST_WAIT", wait)
            // Staging goes under the temporary directory, so give this run its own to inspect afterwards.
            .env("TMPDIR", &staging)
            .env("TEMP", &staging)
            .env("TMP", &staging)
            .args(["difftool", "--no-prompt", "HEAD"])
            .args(extra);
        command
    };
    let launches = || -> Vec<String> {
        fs::read_to_string(&record)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    };
    ok(&sandbox.cli(&["--register-git-difftool", "--local"]));

    // Four changed files: one launch, one review with every file and both sides, added and deleted included.
    ok(&run(&[], "0").output().unwrap());
    assert_eq!(
        launches(),
        [
            "dir|a.txt=old a>new a;added.txt=->new added;gone.txt=old gone>-;sub folder/b & c.txt=old b>new b"
        ]
    );

    // A second run is its own review.
    ok(&run(&[], "0").output().unwrap());
    assert_eq!(launches().len(), 2);

    // A run of one file is not grouped: the client gets the two files, as before.
    let _ = fs::remove_file(&record);
    ok(&run(&["--", "a.txt"], "0").output().unwrap());
    assert_eq!(launches(), ["file|old a>new a"]);

    // Two runs at once stay apart, each with only its own files.
    let _ = fs::remove_file(&record);
    ok(&run(&["--", "a.txt", "added.txt"], "0").output().unwrap());
    assert_eq!(launches(), ["dir|a.txt=old a>new a;added.txt=->new added"]);
    let _ = fs::remove_file(&record);
    let first = run(&["--", "a.txt", "gone.txt"], "400").spawn().unwrap();
    let second = run(&["--", nested, "added.txt"], "400").spawn().unwrap();
    for child in [first, second] {
        assert!(child.wait_with_output().unwrap().status.success());
    }
    let mut together = launches();
    together.sort();
    assert_eq!(
        together,
        [
            "dir|a.txt=old a>new a;gone.txt=old gone>-",
            "dir|added.txt=->new added;sub folder/b & c.txt=old b>new b",
        ]
    );
    let leftovers: Vec<_> = fs::read_dir(&staging)
        .unwrap()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("glassbox-difftool-")
        })
        .collect();
    assert!(
        leftovers.is_empty(),
        "staging directories remain: {leftovers:?}"
    );
}
