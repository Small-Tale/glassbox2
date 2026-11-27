//! HS2-B5K6GM: cited commits in AI notes, pinned and followed through the real host.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

struct Host(Child);

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start(root: &Path, extra: &[(&str, &Path)]) -> (Host, SocketAddr) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_glassbox-server"));
    command
        .env("GLASSBOX_SETTINGS_DIRECTORY", root.join("settings"))
        .env("GLASSBOX_FEEDBACK_DIRECTORY", root.join("feedback"))
        .stdout(Stdio::piped());
    for (key, value) in extra {
        command.env(key, value);
    }
    let mut child = command.spawn().expect("start Glassbox service");
    let stdout = child.stdout.take().expect("capture service stdout");
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = sender.send(result);
    });
    let address = receiver
        .recv_timeout(Duration::from_secs(5))
        .expect("service published its bound address")
        .expect("read service address")
        .trim()
        .parse()
        .expect("valid socket address");
    (Host(child), address)
}

fn exchange(address: SocketAddr, method: &str, endpoint: &str, input: &Value) -> (u16, String) {
    let body = if input.is_null() {
        String::new()
    } else {
        input.to_string()
    };
    let timeout = Duration::from_secs(10);
    let mut connection = TcpStream::connect_timeout(&address, timeout).unwrap();
    connection.set_read_timeout(Some(timeout)).unwrap();
    let request = format!(
        "{method} /api/v1/review/{endpoint} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    connection.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    connection.read_to_string(&mut response).unwrap();
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    let status = headers.split_whitespace().nth(1).unwrap().parse().unwrap();
    (status, body.to_owned())
}

fn post(address: SocketAddr, endpoint: &str, input: &Value) -> (u16, Value) {
    let (status, body) = exchange(address, "POST", endpoint, input);
    (
        status,
        serde_json::from_str(&body).unwrap_or(Value::String(body)),
    )
}

fn git(directory: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .args(["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"])
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
        ])
        .args(arguments)
        .current_dir(directory)
        .output()
        .unwrap();
    assert!(output.status.success(), "git {arguments:?}");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

/// A repository with `destination.ts` and `unchanged.ts` in its first commit, and `destination.ts` changed
/// in its second, so a citation can name a changed or an unchanged file.
fn repository(root: &Path) -> (std::path::PathBuf, String, String) {
    let repo = root.join("repo");
    fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q", "--initial-branch=review"]);
    fs::write(
        repo.join("destination.ts"),
        "export const destination = 1;\n",
    )
    .unwrap();
    fs::write(
        repo.join("unchanged.ts"),
        "export const same = true;\nexport const other = 1;\n",
    )
    .unwrap();
    fs::write(repo.join("bundle.ts"), "export const bundle = 1;\n").unwrap();
    git(&repo, &["add", "."]);
    git(&repo, &["commit", "-qm", "first"]);
    let first = git(&repo, &["rev-parse", "HEAD"]);
    fs::write(
        repo.join("destination.ts"),
        "export const destination = 2;\nexport const added = 1;\n",
    )
    .unwrap();
    git(&repo, &["commit", "-qam", "second"]);
    let second = git(&repo, &["rev-parse", "HEAD"]);
    (repo, first, second)
}

#[test]
fn a_cited_location_resolves_in_its_commit_and_everything_else_is_refused() {
    let scratch = tempfile::tempdir().unwrap();
    let (repo, first, second) = repository(scratch.path());
    let (_host, address) = start(scratch.path(), &[]);
    let locate = |commit: &str, path: &str, line: u32| {
        post(
            address,
            "commit-location",
            &json!({"directory": repo, "commit": commit, "path": path, "line": line}),
        )
    };

    // A changed file: read on the commit side, tied to its index in that commit's review.
    let (status, found) = locate(&second, "destination.ts", 2);
    assert_eq!(status, 200, "{found}");
    assert_eq!(found["path"], "destination.ts");
    assert_eq!(found["side"], "after");
    assert_eq!(found["line"], 2);
    assert_eq!(found["index"], 0);
    assert!(found["diff_revision"].is_string());
    assert!(found["text"].as_str().unwrap().contains("added = 1"));

    // The same cited line in the first commit has different content and no line 2 in `destination.ts`.
    let (status, earlier) = locate(&first, "destination.ts", 1);
    assert_eq!(status, 200);
    assert!(
        earlier["text"]
            .as_str()
            .unwrap()
            .contains("destination = 1")
    );
    assert_eq!(locate(&first, "destination.ts", 2).0, 404);
    assert_ne!(found["revision"], earlier["revision"]);

    // A short or upper-case hash names the same commit.
    let short = &second[..9];
    assert_eq!(locate(short, "destination.ts", 1).0, 200);
    assert_eq!(
        locate(&short.to_ascii_uppercase(), "destination.ts", 1).0,
        200
    );

    // A file the commit did not change is still read from its tree, with no changed-file index.
    let (status, unchanged) = locate(&second, "unchanged.ts", 2);
    assert_eq!(status, 200, "{unchanged}");
    assert!(unchanged["index"].is_null());
    assert!(unchanged["diff_revision"].is_null());

    // Unknown commit, unresolved location, and text that is not a commit.
    let (status, message) = locate("deadbeefdeadbeef", "destination.ts", 1);
    assert_eq!(status, 404);
    assert!(message.as_str().unwrap().contains("not available"));
    for (path, line) in [
        ("absent.ts", 1),
        ("destination.ts", 0),
        ("destination.ts", 99),
    ] {
        let (status, message) = locate(&second, path, line);
        assert_eq!(status, 404, "{path}:{line}");
        assert!(
            message
                .as_str()
                .unwrap()
                .contains("does not exist in that commit")
        );
    }
    for text in [
        "HEAD",
        "main",
        "--help",
        "abc",
        "",
        "zzzzzzzz",
        &format!("{second}0"),
    ] {
        assert_eq!(locate(text, "destination.ts", 1).0, 400, "{text:?}");
    }
    for path in ["../outside.ts", ".git/config", "/etc/passwd", "a\\b"] {
        assert_eq!(locate(&second, path, 1).0, 404, "{path}");
    }
    let plain = scratch.path().join("plain");
    fs::create_dir(&plain).unwrap();
    let (status, _) = post(
        address,
        "commit-location",
        &json!({"directory": plain, "commit": second, "path": "destination.ts", "line": 1}),
    );
    assert_eq!(status, 404, "a folder that is not a repository");
}

fn compile_provider(root: &Path) -> std::path::PathBuf {
    let registry = root.join("providers");
    fs::create_dir(&registry).unwrap();
    let program = root.join(format!("fixture-provider{}", std::env::consts::EXE_SUFFIX));
    let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/analysis_provider.rs");
    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
    let compile = Command::new(rustc)
        .arg("--edition=2024")
        .arg(source)
        .arg("-o")
        .arg(&program)
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let manifest = json!({"version":1,"id":"fixture","name":"Fixture","executable":program});
    fs::write(registry.join("fixture.json"), manifest.to_string()).unwrap();
    registry
}

#[test]
fn an_ai_note_pins_only_resolvable_commit_citations_and_following_one_names_the_commit() {
    let scratch = tempfile::tempdir().unwrap();
    let (repo, first, _) = repository(scratch.path());
    let registry = compile_provider(scratch.path());
    let commits = scratch.path().join("commits.txt");
    // The real commit is cited in upper-case short form; the second line is not in the repository.
    let cited = first[..10].to_ascii_uppercase();
    fs::write(&commits, format!("{cited}\ndeadbeefdeadbeef\n")).unwrap();
    let cache = scratch.path().join("analysis-cache");
    fs::write(repo.join("bundle.ts"), "export const COMMIT_FIXTURE = 2;\n").unwrap();
    let (_host, address) = start(
        scratch.path(),
        &[
            ("GLASSBOX_AI_PROVIDER_DIRECTORY", &registry),
            ("GLASSBOX_AI_PROVIDER", Path::new("fixture")),
            ("GLASSBOX_AI_MODEL_REVISION", Path::new("fixture-revision")),
            ("GLASSBOX_ANALYSIS_CACHE_DIRECTORY", &cache),
            ("GLASSBOX_FIXTURE_COMMIT_FILE", &commits),
        ],
    );
    let source = json!({"kind": "git", "directory": repo, "mode": {"kind": "working_tree"}});
    let (status, files) = post(address, "files", &source);
    assert_eq!(status, 200, "{files}");
    let index = files["files"]
        .as_array()
        .unwrap()
        .iter()
        .position(|file| file["path"] == "bundle.ts")
        .unwrap();
    let selection = json!({"source": source, "index": index, "path": "bundle.ts"});

    let (status, accepted) = post(
        address,
        "analysis",
        &json!({"source": source, "mode": "risk"}),
    );
    assert_eq!(status, 200, "{accepted}");
    let endpoint = format!("analysis/{}", accepted["id"]);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let (_, state) = exchange(address, "GET", &endpoint, &Value::Null);
        let state: Value = serde_json::from_str(&state).unwrap();
        if state["status"] != "running" {
            assert_eq!(state["status"], "complete", "{state}");
            break;
        }
        assert!(Instant::now() < deadline, "{state}");
        std::thread::sleep(Duration::from_millis(20));
    }

    let (_, view) = post(address, "discussion", &json!({"selection": selection}));
    let thread = &view["threads"][0];
    assert_eq!(thread["origin"]["kind"], "ai");
    let locations = thread["origin"]["related_locations"].as_array().unwrap();
    assert_eq!(locations.len(), 5);
    assert_eq!(locations[0]["commit"], first[..10].to_ascii_lowercase());
    assert_eq!(locations[0]["path"], "destination.ts");
    assert!(
        locations[0]["revision"].is_string(),
        "a resolved citation is pinned"
    );
    for (position, reason) in [
        (1, "a commit the repository does not have"),
        (2, "a ref instead of a hash"),
        (3, "a file the commit lacks"),
        (4, "a line past the end"),
    ] {
        assert!(locations[position].is_null(), "{reason} is not offered");
    }

    let follow = |index: usize| {
        post(
            address,
            "discussion/source-link",
            &json!({"selection": selection, "thread": thread["id"], "index": index}),
        )
    };
    let (status, target) = follow(0);
    assert_eq!(status, 200, "{target}");
    assert_eq!(target["kind"], "commit");
    assert_eq!(target["commit"], first[..10].to_ascii_lowercase());
    assert_eq!(target["path"], "destination.ts");
    assert_eq!(target["line"], 1);
    assert_eq!(target["directory"], json!(repo));
    for unresolved in 1..5 {
        assert_eq!(follow(unresolved).0, 404, "location {unresolved}");
    }

    // The note belongs to the file as it was analyzed: once the file changes, the link is refused.
    fs::write(repo.join("bundle.ts"), "export const COMMIT_FIXTURE = 3;\n").unwrap();
    let (status, _) = post(address, "file", &selection);
    assert_eq!(status, 200);
    assert_eq!(follow(0).0, 409);
}
