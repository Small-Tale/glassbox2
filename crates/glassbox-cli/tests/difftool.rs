use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn git(root: &Path, args: &[&str]) {
    assert_success(
        Command::new("git")
            .current_dir(root)
            .args(args)
            .output()
            .unwrap(),
    );
}

fn assert_success(output: Output) {
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn fixture_client(root: &Path) -> PathBuf {
    let source = root.join("client.rs");
    fs::write(
        &source,
        r#"
use std::{env, fs, path::PathBuf};
fn main() {
    let args: Vec<_> = env::args_os().skip(1).collect();
    assert_eq!(args.len(), 3);
    assert_eq!(args[0], "--difftool");
    let before = PathBuf::from(&args[1]);
    let after = PathBuf::from(&args[2]);
    if let Some(launches) = env::var_os("DIFFTOOL_TEST_LAUNCHES") {
        use std::io::Write;
        let mut launches = fs::OpenOptions::new().append(true).create(true).open(launches).unwrap();
        writeln!(launches, "launch").unwrap();
    }
    let mut output = env::var_os("DIFFTOOL_TEST_OUTPUT").map(PathBuf::from).unwrap();
    if before.is_dir() {
        assert!(after.is_dir());
        // Every changed file, in the order Git lists it: path, then both sides.
        let mut files = Vec::new();
        let mut stack = vec![PathBuf::new()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(after.join(&dir)).unwrap() {
                let relative = dir.join(entry.unwrap().file_name());
                if after.join(&relative).is_dir() {
                    stack.push(relative);
                } else {
                    files.push(relative);
                }
            }
        }
        files.sort();
        use std::io::Write;
        let mut record = fs::OpenOptions::new().append(true).create(true).open(&output).unwrap();
        for file in &files {
            writeln!(record, "{}", file.to_string_lossy()).unwrap();
            record.write_all(&fs::read(before.join(file)).unwrap()).unwrap();
            record.write_all(&fs::read(after.join(file)).unwrap()).unwrap();
        }
        let target = std::path::Path::new("sub folder/a & b.txt");
        if files.iter().any(|file| file == target) {
            output.set_extension("directory");
            fs::write(output, [
                fs::read(before.join(target)).unwrap(),
                fs::read(after.join(target)).unwrap(),
            ].concat()).unwrap();
        }
    } else {
        unreachable!("the wrapper always asks Git for directory mode");
    }
    if env::var_os("DIFFTOOL_TEST_FAIL").is_some() {
        std::process::exit(7);
    }
}
"#,
    )
    .unwrap();
    let binary = root.join(format!(
        "client with spaces{}",
        std::env::consts::EXE_SUFFIX
    ));
    assert_success(
        Command::new("rustc")
            .arg(&source)
            .arg("-o")
            .arg(&binary)
            .output()
            .unwrap(),
    );
    binary
}

#[test]
fn real_git_passes_live_paths_preserves_arguments_and_reports_child_failure() {
    let scratch = tempfile::tempdir().unwrap();
    let root = scratch.path().join("repo with spaces");
    fs::create_dir_all(root.join("sub folder")).unwrap();
    let file = "sub folder/a & b.txt";
    let other = "other.txt";
    git(&root, &["init", "-q"]);
    git(&root, &["config", "user.email", "fixture@example.invalid"]);
    git(&root, &["config", "user.name", "Fixture"]);
    git(&root, &["config", "core.autocrlf", "false"]);
    git(&root, &["config", "diff.tool", "another-tool"]);
    fs::write(root.join(file), "old & content\n").unwrap();
    fs::write(root.join(other), "old other\n").unwrap();
    git(&root, &["add", "."]);
    git(&root, &["commit", "-qm", "initial"]);
    fs::write(root.join(file), "new & content\n").unwrap();
    fs::write(root.join(other), "new other\n").unwrap();
    let client = fixture_client(scratch.path());
    let record = scratch.path().join("record");
    let cli = || {
        let mut command = Command::new(env!("CARGO_BIN_EXE_glassbox-cli"));
        command
            .current_dir(&root)
            .env("GLASSBOX_DIFFTOOL_CLIENT", &client)
            .env("DIFFTOOL_TEST_OUTPUT", &record);
        command
    };

    assert_success(cli().args(["--no-prompt", "--", file]).output().unwrap());
    let captured = fs::read_to_string(&record).unwrap();
    assert!(captured.lines().next().unwrap().ends_with("a & b.txt"));
    assert!(captured.ends_with("old & content\nnew & content\n"));

    assert_success(cli().args(["--dir-diff", "HEAD", "--"]).output().unwrap());
    assert_eq!(
        fs::read_to_string(record.with_extension("directory")).unwrap(),
        "old & content\nnew & content\n"
    );
    let status = cli()
        .env("DIFFTOOL_TEST_FAIL", "1")
        .args(["--no-prompt", "--", file])
        .output()
        .unwrap();
    assert!(!status.status.success());
    let configured = Command::new("git")
        .current_dir(&root)
        .args(["config", "--get", "diff.tool"])
        .output()
        .unwrap();
    assert_eq!(
        String::from_utf8(configured.stdout).unwrap().trim(),
        "another-tool"
    );
}

#[test]
fn real_git_accepts_revisions_ranges_and_pathspecs_but_never_another_tool() {
    let scratch = tempfile::tempdir().unwrap();
    let root = scratch.path().join("repo with spaces");
    fs::create_dir_all(root.join("sub folder")).unwrap();
    git(&root, &["init", "-q", "--initial-branch=main"]);
    git(&root, &["config", "user.email", "fixture@example.invalid"]);
    git(&root, &["config", "user.name", "Fixture"]);
    git(&root, &["config", "core.autocrlf", "false"]);
    let file = "sub folder/a & b.txt";
    for (revision, text) in [("first", "one\n"), ("second", "two\n")] {
        fs::write(root.join(file), text).unwrap();
        fs::write(
            root.join("-t"),
            format!("{revision} pathspec named like an option\n"),
        )
        .unwrap();
        git(&root, &["add", "."]);
        git(&root, &["commit", "-qm", revision]);
    }
    let client = fixture_client(scratch.path());
    let record = scratch.path().join("record");
    let cli = |args: &[&str]| {
        let _ = fs::remove_file(&record);
        Command::new(env!("CARGO_BIN_EXE_glassbox-cli"))
            .current_dir(&root)
            .env("GLASSBOX_DIFFTOOL_CLIENT", &client)
            .env("DIFFTOOL_TEST_OUTPUT", &record)
            .args(args)
            .output()
            .unwrap()
    };
    let compared = |args: &[&str]| {
        assert_success(cli(args));
        fs::read_to_string(&record).unwrap()
    };

    // A revision, a range, a three-dot range and a pathspec after `--` all reach the client.
    for args in [
        &["--no-prompt", "HEAD~1", "HEAD", "--", file][..],
        &["--no-prompt", "HEAD~1..HEAD", "--", file],
        &["--no-prompt", "HEAD~1...HEAD", "--", file],
        &["--no-prompt", "HEAD~1", "--", file],
    ] {
        let captured = compared(args);
        assert!(
            captured.lines().next().unwrap().ends_with("a & b.txt"),
            "{args:?}"
        );
        assert!(captured.ends_with("one\ntwo\n"), "{args:?}: {captured}");
    }
    // A pathspec that looks like an option is a path once it follows `--`.
    let named = compared(&["--no-prompt", "HEAD~1", "--", "-t"]);
    assert!(
        named.contains("first pathspec named like an option"),
        "{named}"
    );
    assert!(
        named.ends_with("second pathspec named like an option\n"),
        "{named}"
    );

    // Another tool cannot be selected: the wrapper stops before Git or the client runs.
    for args in [
        &["--tool=vimdiff", "HEAD~1"][..],
        &["-t", "vimdiff", "HEAD~1"],
        &["--to=vimdiff", "HEAD~1"],
        &["--extcmd=exit 0", "HEAD~1"],
        &["-x", "exit 0", "HEAD~1"],
        &["--gui", "HEAD~1"],
        &["--tool-help"],
    ] {
        let output = cli(args);
        assert!(!output.status.success(), "{args:?}");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("would replace the Glassbox tool"),
            "{args:?}: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!record.exists(), "{args:?} launched a client");
    }
}

#[test]
fn one_invocation_is_one_launch_with_every_file_in_order_and_runs_stay_separate() {
    // HS2-559FEK
    let scratch = tempfile::tempdir().unwrap();
    let root = scratch.path().join("repo");
    fs::create_dir_all(root.join("sub folder")).unwrap();
    git(&root, &["init", "-q"]);
    git(&root, &["config", "user.email", "fixture@example.invalid"]);
    git(&root, &["config", "user.name", "Fixture"]);
    git(&root, &["config", "core.autocrlf", "false"]);
    let files = ["z.txt", "sub folder/a & b.txt", "m.txt"];
    for file in files {
        fs::write(root.join(file), format!("old {file}\n")).unwrap();
    }
    git(&root, &["add", "."]);
    git(&root, &["commit", "-qm", "initial"]);
    for file in files {
        fs::write(root.join(file), format!("new {file}\n")).unwrap();
    }
    let client = fixture_client(scratch.path());
    let record = scratch.path().join("record");
    let launches = scratch.path().join("launches");
    let run = || {
        assert_success(
            Command::new(env!("CARGO_BIN_EXE_glassbox-cli"))
                .current_dir(&root)
                .env("GLASSBOX_DIFFTOOL_CLIENT", &client)
                .env("DIFFTOOL_TEST_OUTPUT", &record)
                .env("DIFFTOOL_TEST_LAUNCHES", &launches)
                .args(["--no-prompt"])
                .output()
                .unwrap(),
        );
    };
    run();
    assert_eq!(fs::read_to_string(&launches).unwrap().lines().count(), 1);
    let captured = fs::read_to_string(&record).unwrap();
    let headers: Vec<_> = captured
        .lines()
        .filter(|line| files.iter().any(|file| file == line))
        .collect();
    assert_eq!(
        headers,
        ["m.txt", "sub folder/a & b.txt", "z.txt"],
        "{captured}"
    );
    for file in files {
        assert!(
            captured.contains(&format!("old {file}\nnew {file}\n")),
            "{captured}"
        );
    }
    // A second invocation is its own review.
    run();
    assert_eq!(fs::read_to_string(&launches).unwrap().lines().count(), 2);
}
