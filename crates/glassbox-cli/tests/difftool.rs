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
    let mut output = env::var_os("DIFFTOOL_TEST_OUTPUT").map(PathBuf::from).unwrap();
    if before.is_dir() {
        assert!(after.is_dir());
        output.set_extension("directory");
        fs::write(output, [
            fs::read(before.join("sub folder/a & b.txt")).unwrap(),
            fs::read(after.join("sub folder/a & b.txt")).unwrap(),
        ].concat()).unwrap();
    } else {
        let mut record = fs::OpenOptions::new().append(true).create(true).open(output).unwrap();
        use std::io::Write;
        writeln!(record, "{}", after.to_string_lossy()).unwrap();
        record.write_all(&fs::read(&before).unwrap()).unwrap();
        record.write_all(&fs::read(&after).unwrap()).unwrap();
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
