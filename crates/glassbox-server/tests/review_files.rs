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
async fn a_missing_repository_path_can_be_corrected() -> io::Result<()> {
    let scratch = tempfile::tempdir()?;
    let directory = scratch.path().join("review folder");
    let source = json!({
        "kind": "git",
        "directory": directory,
        "mode": {"kind": "working_tree"},
    });
    let host = LocalHost::start(None).await?;

    let (status, message) = post(&host, "files", source.clone()).await;
    assert_eq!(status, "HTTP/1.1 400 Bad Request");
    assert_eq!(
        message,
        "Repository folder not found. Check the path and try again."
    );

    fs::create_dir(&directory)?;
    let (status, message) = post(&host, "files", source.clone()).await;
    assert_eq!(status, "HTTP/1.1 400 Bad Request");
    assert!(message.as_str().unwrap().contains("not a git repository"));

    assert!(
        Command::new("git")
            .current_dir(&directory)
            .args(["init", "-q"])
            .status()?
            .success()
    );
    fs::write(directory.join("new.txt"), "new file\n")?;
    let (status, review) = post(&host, "files", source).await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(review["files"][0]["path"], "new.txt");
    host.stop().await
}

#[tokio::test]
async fn serves_only_the_selected_media_revision() -> io::Result<()> {
    let scratch = tempfile::tempdir()?;
    let before = scratch.path().join("before.svg");
    let after = scratch.path().join("after.svg");
    let old_svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>"#;
    let new_svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>"#;
    fs::write(&before, old_svg)?;
    fs::write(&after, new_svg)?;
    let host = LocalHost::start(None).await?;
    let mut selection = json!({
        "source": {"kind": "paths", "before": before, "after": after},
        "index": 0,
        "path": "after.svg",
    });
    let (status, file) = post(&host, "file", selection.clone()).await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(file["kind"], "media");
    assert_eq!(file["after"]["content_type"], "image/svg+xml");
    assert_eq!(file["after"]["size"], new_svg.len());

    let mut comment = json!({
        "selection": selection,
        "operation": {
            "kind": "create",
            "anchor": {
                "path": "after.svg", "side": "after", "revision": file["before"]["revision"],
                "target": {"kind": "image_region", "left": 0.25, "top": 0.25, "width": 0.5, "height": 0.5}
            },
            "category": "note", "author": "Reviewer", "markdown": "Check this region."
        }
    });
    assert_eq!(
        post(&host, "discussion", comment.clone()).await.0,
        "HTTP/1.1 409 Conflict"
    );
    comment["operation"]["anchor"]["revision"] = file["after"]["revision"].clone();
    let (status, discussion) = post(&host, "discussion", comment).await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(
        discussion["threads"][0]["anchor"]["target"]["kind"],
        "image_region"
    );

    selection["side"] = json!("before");
    selection["revision"] = file["before"]["revision"].clone();
    assert_eq!(
        post(&host, "media", selection.clone()).await,
        ("HTTP/1.1 200 OK".into(), json!(old_svg))
    );
    selection["side"] = json!("after");
    assert_eq!(
        post(&host, "media", selection.clone()).await.0,
        "HTTP/1.1 404 Not Found"
    );
    selection["revision"] = file["after"]["revision"].clone();
    assert_eq!(
        post(&host, "media", selection.clone()).await,
        ("HTTP/1.1 200 OK".into(), json!(new_svg))
    );
    fs::write(after, old_svg)?;
    assert_ne!(
        post(&host, "media", selection.clone()).await.0,
        "HTTP/1.1 200 OK"
    );
    selection["path"] = json!("different.svg");
    assert_eq!(
        post(&host, "media", selection).await.0,
        "HTTP/1.1 400 Bad Request"
    );
    Ok(())
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
    let oid = "a".repeat(64);
    fs::write(
        repo.join("preview.png"),
        format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize 5\n"),
    )?;
    let source = json!({"kind":"git", "directory":repo, "mode":{"kind":"working_tree"}});
    let (_, files) = post(&host, "files", source.clone()).await;
    let index = files["files"]
        .as_array()
        .unwrap()
        .iter()
        .position(|file| file["path"] == "preview.png")
        .unwrap();
    let (status, media) = post(
        &host,
        "file",
        json!({"source":source, "index":index, "path":"preview.png"}),
    )
    .await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(media["kind"], "unavailable_lfs");
    assert_eq!(media["after"]["object"]["oid"], oid);
    assert_eq!(media["after"]["reason"], "missing");
    host.stop().await
}

#[tokio::test]
async fn serves_bounded_unchanged_lines_for_the_displayed_revision() -> io::Result<()> {
    // HS2-DZ8ZR6: context comes from the displayed side and only for the revision the client holds.
    let scratch = tempfile::tempdir()?;
    let before = scratch.path().join("before.txt");
    let after = scratch.path().join("after.txt");
    let lines: Vec<String> = (1..=30).map(|number| format!("line {number}")).collect();
    fs::write(&before, lines.join("\n") + "\n")?;
    let mut changed = lines.clone();
    changed[14] = "changed 15".into();
    let tail = changed.join("\n");
    fs::write(&after, &tail)?;
    let host = LocalHost::start(None).await?;
    let selection = json!({
        "source": {"kind": "paths", "before": before, "after": after},
        "index": 0,
        "path": "after.txt",
    });
    let (status, file) = post(&host, "file", selection.clone()).await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(file["kind"], "text");
    assert_eq!(file["after_lines"], 30);
    let ask = |start: u32, end: u32, revision: &Value| {
        let mut request = selection.clone();
        request["revision"] = revision.clone();
        request["start"] = json!(start);
        request["end"] = json!(end);
        request
    };

    let (status, context) = post(&host, "context", ask(1, 3, &file["revision"])).await;
    assert_eq!(status, "HTTP/1.1 200 OK");
    assert_eq!(context["total"], 30);
    assert_eq!(
        context["lines"],
        json!([
            {"text": "line 1", "ends_with_newline": true},
            {"text": "line 2", "ends_with_newline": true},
            {"text": "line 3", "ends_with_newline": true},
        ])
    );

    let (_, tail) = post(&host, "context", ask(29, 40, &file["revision"])).await;
    assert_eq!(tail["lines"].as_array().map(Vec::len), Some(2));
    assert_eq!(
        tail["lines"][1],
        json!({"text": "line 30", "ends_with_newline": false})
    );

    let (status, _) = post(&host, "context", ask(1, 1000, &file["revision"])).await;
    assert_eq!(status, "HTTP/1.1 400 Bad Request");
    let (status, _) = post(&host, "context", ask(0, 3, &file["revision"])).await;
    assert_eq!(status, "HTTP/1.1 400 Bad Request");
    let (status, _) = post(&host, "context", ask(5, 4, &file["revision"])).await;
    assert_eq!(status, "HTTP/1.1 400 Bad Request");

    fs::write(
        &after,
        changed.join("\n").replace("line 3", "edited 3") + "\n",
    )?;
    let (status, message) = post(&host, "context", ask(1, 3, &file["revision"])).await;
    assert_eq!(status, "HTTP/1.1 409 Conflict");
    assert!(
        message
            .as_str()
            .is_some_and(|text| text.contains("changed"))
    );
    Ok(())
}
