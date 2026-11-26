use std::fs;
use std::io;
use std::path::Path;
use std::process::Command;

use glassbox_server::LocalHost;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// HS2-E3YMJ5: the symbol outline of the displayed side of a file, through the real host and a real repository.

async fn post(host: &LocalHost, endpoint: &str, input: Value) -> (String, Value) {
    let body = input.to_string();
    let mut stream = tokio::net::TcpStream::connect(host.address())
        .await
        .unwrap();
    stream
        .write_all(
            format!(
                "POST /api/v1/review/{endpoint} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                host.address(),
                body.len()
            )
            .as_bytes(),
        )
        .await
        .unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).await.unwrap();
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    (
        headers.lines().next().unwrap().to_owned(),
        serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.into())),
    )
}

fn git(root: &Path, arguments: &[&str]) {
    let status = Command::new("git")
        .current_dir(root)
        .args([
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
        ])
        .args(arguments)
        .status()
        .unwrap();
    assert!(status.success(), "git {arguments:?}");
}

fn names(outline: &Value) -> Vec<(String, u64, u64)> {
    outline["symbols"]
        .as_array()
        .unwrap()
        .iter()
        .map(|symbol| {
            (
                symbol["name"].as_str().unwrap().to_owned(),
                symbol["line"].as_u64().unwrap(),
                symbol["depth"].as_u64().unwrap(),
            )
        })
        .collect()
}

#[tokio::test]
async fn outlines_each_side_of_a_changed_file_and_refuses_what_it_cannot() -> io::Result<()> {
    let scratch = tempfile::tempdir()?;
    let root = scratch.path();
    git(root, &["init", "-q"]);
    fs::write(root.join("lib.rs"), "fn alpha() {}\nfn beta() {}\n")?;
    fs::write(root.join("notes.md"), "# Notes\n")?;
    fs::write(root.join("gone.py"), "def old():\n    pass\n")?;
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "base"]);
    // `alpha` moves down and gains a neighbor; one file is deleted, one added, one is not source code.
    fs::write(
        root.join("lib.rs"),
        "// header\nfn beta() {}\nstruct Gamma;\nimpl Gamma {\n    fn new() {}\n}\nfn alpha() {}\n",
    )?;
    fs::write(root.join("notes.md"), "# Notes\nmore\n")?;
    fs::remove_file(root.join("gone.py"))?;
    fs::write(
        root.join("fresh.py"),
        "class Fresh:\n    def run(self): ...\n",
    )?;
    git(root, &["add", "-N", "fresh.py"]);

    let host = LocalHost::start(None).await?;
    let source = json!({"kind": "git", "directory": root, "mode": {"kind": "working_tree"}});
    let (status, files) = post(&host, "files", source.clone()).await;
    assert_eq!(status, "HTTP/1.1 200 OK", "{files}");
    let selection = |path: &str| {
        let index = files["files"]
            .as_array()
            .unwrap()
            .iter()
            .position(|file| file["path"] == path)
            .unwrap_or_else(|| panic!("{path} is not changed"));
        json!({"source": source, "path": path, "index": index})
    };
    let revision = |selection: Value| {
        let host = &host;
        async move {
            let (status, diff) = post(host, "file", selection).await;
            assert_eq!(status, "HTTP/1.1 200 OK", "{diff}");
            diff["revision"].clone()
        }
    };
    let ask = |selection: &Value, revision: &Value, side: &str| json!({"selection": selection, "revision": revision, "side": side});

    // Each side lists its own lines, so a moved declaration is found where that side has it.
    let lib = selection("lib.rs");
    let lib_revision = revision(lib.clone()).await;
    let (status, after) = post(&host, "outline", ask(&lib, &lib_revision, "after")).await;
    assert_eq!(status, "HTTP/1.1 200 OK", "{after}");
    assert_eq!(after["status"], "found");
    assert_eq!(
        names(&after),
        [
            ("beta".to_owned(), 2, 0),
            ("Gamma".to_owned(), 3, 0),
            ("impl Gamma".to_owned(), 4, 0),
            ("new".to_owned(), 5, 1),
            ("alpha".to_owned(), 7, 0),
        ]
    );
    assert_eq!(after["file"]["path"], "lib.rs");
    assert_eq!(after["file"]["side"], "after");
    assert_eq!(after["file"]["index"], lib["index"]);
    assert_eq!(after["file"]["diff_revision"], lib_revision);
    assert!(
        after["file"]["text"]
            .as_str()
            .unwrap()
            .starts_with("// header")
    );
    assert_eq!(after["truncated"], false);
    let (_, before) = post(&host, "outline", ask(&lib, &lib_revision, "before")).await;
    assert_eq!(
        names(&before),
        [("alpha".to_owned(), 1, 0), ("beta".to_owned(), 2, 0)]
    );
    assert_ne!(before["file"]["revision"], after["file"]["revision"]);

    // A deleted or added file has only one side; the other side is unavailable, not an error.
    let gone = selection("gone.py");
    let gone_revision = revision(gone.clone()).await;
    let (_, removed) = post(&host, "outline", ask(&gone, &gone_revision, "before")).await;
    assert_eq!(names(&removed), [("old".to_owned(), 1, 0)]);
    let (_, none) = post(&host, "outline", ask(&gone, &gone_revision, "after")).await;
    assert_eq!(none["status"], "unavailable");
    let fresh = selection("fresh.py");
    let fresh_revision = revision(fresh.clone()).await;
    let (_, added) = post(&host, "outline", ask(&fresh, &fresh_revision, "after")).await;
    assert_eq!(
        names(&added),
        [("Fresh".to_owned(), 1, 0), ("run".to_owned(), 2, 1)]
    );
    let (_, nothing) = post(&host, "outline", ask(&fresh, &fresh_revision, "before")).await;
    assert_eq!(nothing["status"], "unavailable");

    // Languages without a parser, and comparisons that are not Git, are unsupported.
    let notes = selection("notes.md");
    let notes_revision = revision(notes.clone()).await;
    let (_, unsupported) = post(&host, "outline", ask(&notes, &notes_revision, "after")).await;
    assert_eq!(unsupported["status"], "unsupported");
    let before_file = root.join("lib.rs");
    let paths = json!({
        "selection": {
            "source": {"kind": "paths", "before": before_file, "after": before_file},
            "path": "lib.rs",
            "index": 0,
        },
        "revision": "any",
        "side": "after",
    });
    let (status, outline) = post(&host, "outline", paths).await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(outline["status"], "unsupported");

    // A stale diff or a changed file is refused so the client reloads instead of jumping to an old line.
    let (status, _) = post(&host, "outline", ask(&lib, &json!("old"), "after")).await;
    assert_eq!(status, "HTTP/1.1 409 Conflict");
    fs::write(root.join("lib.rs"), "fn changed_again() {}\n")?;
    let (status, _) = post(&host, "outline", ask(&lib, &lib_revision, "after")).await;
    assert_eq!(status, "HTTP/1.1 409 Conflict");
    Ok(())
}

#[tokio::test]
async fn a_source_file_over_the_size_limit_is_unavailable() -> io::Result<()> {
    let scratch = tempfile::tempdir()?;
    let root = scratch.path();
    git(root, &["init", "-q"]);
    fs::write(root.join("big.rs"), "fn small() {}\n")?;
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "base"]);
    fs::write(root.join("big.rs"), "fn big() {}\n".repeat(30_000))?;
    let host = LocalHost::start(None).await?;
    let source = json!({"kind": "git", "directory": root, "mode": {"kind": "working_tree"}});
    let selection = json!({"source": source, "path": "big.rs", "index": 0});
    let (_, diff) = post(&host, "file", selection.clone()).await;
    let request =
        |side: &str| json!({"selection": selection, "revision": diff["revision"], "side": side});
    let (_, large) = post(&host, "outline", request("after")).await;
    assert_eq!(large["status"], "unavailable");
    let (_, small) = post(&host, "outline", request("before")).await;
    assert_eq!(small["status"], "found");
    Ok(())
}
