use std::process::Command;
use std::{fs, io};

use glassbox_server::{DifftoolInput, LocalHost};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
            ).as_bytes(),
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

#[tokio::test]
async fn reads_git_path_and_difftool_sources_through_the_real_host() -> io::Result<()> {
    let scratch = tempfile::tempdir()?;
    let repo = scratch.path().join("repository");
    let before = scratch.path().join("before");
    let after = scratch.path().join("after");
    fs::create_dir(&repo)?;
    fs::create_dir(&before)?;
    fs::create_dir(&after)?;
    fs::write(repo.join("untracked.txt"), "new\n")?;
    fs::write(after.join("one & two.txt"), "new\n")?;
    let git = Command::new("git")
        .args(["init", "--initial-branch=review-test", "-q"])
        .current_dir(&repo)
        .status()?;
    assert!(git.success());
    let host = LocalHost::start_with_difftool(
        None,
        Some(DifftoolInput {
            before: before.clone(),
            after: after.clone(),
        }),
    )
    .await?;

    let (status, git) = post(
        &host,
        "files",
        json!({"kind":"git", "directory":repo, "mode":{"kind":"working_tree"}}),
    )
    .await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(git["branch"], "review-test");
    assert_eq!(git["files"][0]["path"], "untracked.txt");
    assert_eq!(git["files"][0]["status"], "added");

    let (_, direct) = post(
        &host,
        "files",
        json!({"kind":"paths", "before":before, "after":after}),
    )
    .await;
    assert_eq!(direct["files"][0]["status"], "added");
    assert_eq!(direct["files"][0]["path"], "one & two.txt");
    let (_, difftool) = post(&host, "files", json!({"kind":"difftool"})).await;
    assert_eq!(difftool["identity"], "Git difftool");
    assert_eq!(difftool["files"], direct["files"]);

    let (_, empty) = post(
        &host,
        "files",
        json!({"kind":"paths", "before":after, "after":after}),
    )
    .await;
    assert_eq!(empty["files"], json!([]));
    let (status, _) = post(
        &host,
        "files",
        json!({"kind":"paths", "before":after.join("missing"), "after":after}),
    )
    .await;
    assert_eq!(status, "HTTP/1.1 400 Bad Request");
    let source = json!({"kind":"difftool"});
    let (status, content) = post(
        &host,
        "file",
        json!({"source":source, "index":0, "path":"one & two.txt"}),
    )
    .await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(content["kind"], "text");
    assert_eq!(content["hunks"][0]["lines"][0]["after_line"], 1);
    assert_eq!(content["hunks"][0]["lines"][0]["before_line"], Value::Null);
    assert_eq!(content["hunks"][0]["lines"][0]["text"], "new");
    let (status, _) = post(
        &host,
        "file",
        json!({"source":source, "index":0, "path":"stale.txt"}),
    )
    .await;
    assert_eq!(status, "HTTP/1.1 400 Bad Request");
    host.stop().await
}
