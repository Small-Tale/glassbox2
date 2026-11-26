//! HS2-TGAGQ4: moving a line comment thread to another line or side, against the real host.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{Value, json};

struct Host(Child);

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start(root: &Path) -> (Host, SocketAddr) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_glassbox-server"))
        .env("GLASSBOX_SETTINGS_DIRECTORY", root.join("settings"))
        .env("GLASSBOX_FEEDBACK_DIRECTORY", root.join("feedback"))
        .stdout(Stdio::piped())
        .spawn()
        .expect("start Glassbox service");
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

fn post(address: SocketAddr, endpoint: &str, input: &Value) -> (u16, Value) {
    let body = input.to_string();
    let timeout = Duration::from_secs(10);
    let mut connection = TcpStream::connect_timeout(&address, timeout).unwrap();
    connection.set_read_timeout(Some(timeout)).unwrap();
    let request = format!(
        "POST /api/v1/review/{endpoint} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    connection.write_all(request.as_bytes()).unwrap();
    let mut response = String::new();
    connection.read_to_string(&mut response).unwrap();
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    let status = headers.split_whitespace().nth(1).unwrap().parse().unwrap();
    (
        status,
        serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.into())),
    )
}

struct Fixture {
    selection: Value,
    revision: String,
}

fn fixture(root: &Path, address: SocketAddr) -> Fixture {
    let folder = root.join("pair");
    fs::create_dir_all(&folder).unwrap();
    let (before, after) = (folder.join("before.txt"), folder.join("after.txt"));
    fs::write(&before, "one\ntwo\nthree\nfour\nfive\nsix\n").unwrap();
    fs::write(&after, "one\ntwo\nTHREE\nfour\nfive\nsix\n").unwrap();
    let selection = json!({
        "source": {"kind": "paths", "before": before, "after": after},
        "index": 0,
        "path": "after.txt",
    });
    let (status, file) = post(address, "file", &selection);
    assert_eq!(status, 200);
    Fixture {
        selection,
        revision: file["revision"].as_str().unwrap().to_owned(),
    }
}

fn discuss(address: SocketAddr, fixture: &Fixture, operation: Value) -> (u16, Value) {
    post(
        address,
        "discussion",
        &json!({"selection": fixture.selection, "operation": operation}),
    )
}

fn anchor(fixture: &Fixture, side: &str, line: u32, revision: &str) -> Value {
    let _ = fixture;
    json!({"path": "after.txt", "side": side, "revision": revision,
           "target": {"kind": "line", "start": line, "end": line}})
}

fn thread(view: &Value) -> &Value {
    &view["threads"][0]
}

#[test]
fn a_thread_moves_to_another_line_or_side_and_keeps_its_replies() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path());
    let file = fixture(scratch.path(), address);
    let (status, created) = discuss(
        address,
        &file,
        json!({"kind": "create", "anchor": anchor(&file, "after", 3, &file.revision),
               "category": "note", "author": "Reviewer", "markdown": "Check this."}),
    );
    assert_eq!(status, 200);
    let id = thread(&created)["id"].as_u64().unwrap();
    let (status, replied) = discuss(
        address,
        &file,
        json!({"kind": "apply", "id": id, "revision": thread(&created)["revision"],
               "change": {"kind": "reply", "author": "Author", "markdown": "Will do."}}),
    );
    assert_eq!(status, 200);
    let revision = thread(&replied)["revision"].clone();

    // Another line of the same side.
    let (status, moved) = discuss(
        address,
        &file,
        json!({"kind": "move", "id": id, "revision": revision,
               "anchor": anchor(&file, "after", 4, &file.revision)}),
    );
    assert_eq!(status, 200, "{moved}");
    assert_eq!(thread(&moved)["anchor"]["target"]["start"], 4);
    assert_eq!(thread(&moved)["replies"].as_array().map(Vec::len), Some(1));
    assert_eq!(thread(&moved)["opening"]["markdown"], "Check this.");
    assert_eq!(thread(&moved)["id"], id);

    // The other side: the removed line exists there.
    let revision = thread(&moved)["revision"].clone();
    let (status, other_side) = discuss(
        address,
        &file,
        json!({"kind": "move", "id": id, "revision": revision,
               "anchor": anchor(&file, "before", 3, &file.revision)}),
    );
    assert_eq!(status, 200, "{other_side}");
    assert_eq!(thread(&other_side)["anchor"]["side"], "before");
    assert_eq!(thread(&other_side)["anchor"]["target"]["start"], 3);
    assert_eq!(
        thread(&other_side)["replies"].as_array().map(Vec::len),
        Some(1)
    );
}

#[test]
fn a_refused_destination_leaves_the_thread_where_it_was() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path());
    let file = fixture(scratch.path(), address);
    let (_, created) = discuss(
        address,
        &file,
        json!({"kind": "create", "anchor": anchor(&file, "after", 3, &file.revision),
               "category": "note", "author": "Reviewer", "markdown": "Check this."}),
    );
    let id = thread(&created)["id"].as_u64().unwrap();
    let revision = thread(&created)["revision"].clone();
    let refuse = |anchor: Value, thread_revision: Value, expected: u16| {
        let (status, body) = discuss(
            address,
            &file,
            json!({"kind": "move", "id": id, "revision": thread_revision, "anchor": anchor}),
        );
        assert_eq!(status, expected, "{body}");
    };
    // A line the diff does not show (including line 0), and a revision the file no longer has.
    refuse(
        anchor(&file, "after", 99, &file.revision),
        revision.clone(),
        409,
    );
    refuse(anchor(&file, "after", 4, "stale"), revision.clone(), 409);
    refuse(
        anchor(&file, "before", 0, &file.revision),
        revision.clone(),
        409,
    );
    // Another file, a region, and a range are not line moves within this file.
    let mut elsewhere = anchor(&file, "after", 4, &file.revision);
    elsewhere["path"] = json!("other.txt");
    refuse(elsewhere, revision.clone(), 409);
    let region = json!({"path": "after.txt", "side": "after", "revision": file.revision,
        "target": {"kind": "image_region", "left": 0.1, "top": 0.1, "width": 0.2, "height": 0.2}});
    refuse(region, revision.clone(), 400);
    let range = json!({"path": "after.txt", "side": "after", "revision": file.revision,
        "target": {"kind": "line", "start": 3, "end": 4}});
    refuse(range, revision.clone(), 409);
    // A thread edited since the person opened it conflicts instead of being overwritten.
    refuse(anchor(&file, "after", 4, &file.revision), json!(999), 409);

    let (status, view) = discuss(address, &file, json!(null));
    assert_eq!(status, 200);
    assert_eq!(thread(&view)["anchor"]["target"]["start"], 3);
    assert_eq!(thread(&view)["anchor"]["side"], "after");
    assert_eq!(thread(&view)["revision"], revision);
}

#[test]
fn a_stale_thread_can_be_rebound_to_a_line_of_the_current_file() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path());
    let file = fixture(scratch.path(), address);
    let (_, created) = discuss(
        address,
        &file,
        json!({"kind": "create", "anchor": anchor(&file, "after", 3, &file.revision),
               "category": "note", "author": "Reviewer", "markdown": "Check this."}),
    );
    let id = thread(&created)["id"].as_u64().unwrap();
    // The file changes elsewhere, so the thread's anchor revision is no longer current.
    let after = scratch.path().join("pair").join("after.txt");
    fs::write(&after, "one\ntwo\nTHREE\nfour\nfive\nSIX\n").unwrap();
    let (_, changed) = post(address, "file", &file.selection);
    let current = changed["revision"].as_str().unwrap().to_owned();
    assert_ne!(current, file.revision);
    let (status, view) = discuss(address, &file, json!(null));
    assert_eq!(status, 200);
    assert_eq!(
        thread(&view)["anchor"]["revision"],
        file.revision,
        "the thread is stale"
    );

    let (status, moved) = discuss(
        address,
        &file,
        json!({"kind": "move", "id": id, "revision": thread(&view)["revision"],
               "anchor": anchor(&file, "after", 6, &current)}),
    );
    assert_eq!(status, 200, "{moved}");
    assert_eq!(thread(&moved)["anchor"]["revision"], current);
    assert_eq!(thread(&moved)["anchor"]["target"]["start"], 6);
}

// HS2-RV5BD8: suggestions for stale comments, offered only for a unique, shown match and confirmed by a move.

fn write_after(root: &Path, lines: &[&str]) {
    fs::write(root.join("pair").join("after.txt"), lines.join("\n") + "\n").unwrap();
}

fn current_revision(address: SocketAddr, file: &Fixture) -> String {
    let (status, content) = post(address, "file", &file.selection);
    assert_eq!(status, 200);
    content["revision"].as_str().unwrap().to_owned()
}

fn relocate(address: SocketAddr, file: &Fixture, id: u64) -> Value {
    let (status, body) = post(
        address,
        "discussion/relocate",
        &json!({"selection": file.selection, "thread": id}),
    );
    assert_eq!(status, 200, "{body}");
    body
}

/// A host with a thread on after line 3 of `before: [one, two, needle line, four, five, six]`.
fn quoted_thread(root: &Path) -> (Host, SocketAddr, Fixture, u64) {
    let (host, address) = start(root);
    let folder = root.join("pair");
    fs::create_dir_all(&folder).unwrap();
    let before = folder.join("before.txt");
    fs::write(
        &before,
        "one\ntwo\nneedle line\nfour\nfive\nsix\nseven\neight\n",
    )
    .unwrap();
    write_after(
        root,
        &[
            "one",
            "two",
            "needle line",
            "four",
            "five",
            "SIX",
            "seven",
            "eight",
        ],
    );
    let selection = json!({
        "source": {"kind": "paths", "before": before, "after": folder.join("after.txt")},
        "index": 0,
        "path": "after.txt",
    });
    let mut file = Fixture {
        selection,
        revision: String::new(),
    };
    file.revision = current_revision(address, &file);
    let (status, created) = discuss(
        address,
        &file,
        json!({"kind": "create", "anchor": anchor(&file, "after", 3, &file.revision),
               "category": "note", "author": "Reviewer", "markdown": "Check this."}),
    );
    assert_eq!(status, 200, "{created}");
    let id = thread(&created)["id"].as_u64().unwrap();
    assert_eq!(
        thread(&created)["anchor"]["quote"],
        "needle line",
        "the host records the line"
    );
    (host, address, file, id)
}

#[test]
fn a_current_thread_has_nothing_to_suggest() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address, file, id) = quoted_thread(scratch.path());
    assert_eq!(relocate(address, &file, id)["outcome"], "current");
}

#[test]
fn a_unique_shown_match_is_suggested_and_confirming_moves_the_thread() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address, file, id) = quoted_thread(scratch.path());
    write_after(
        scratch.path(),
        &[
            "one",
            "two",
            "four",
            "five",
            "needle line",
            "SIX",
            "seven",
            "eight",
        ],
    );
    let suggestion = relocate(address, &file, id);
    assert_eq!(suggestion["outcome"], "suggestion");
    assert_eq!(suggestion["side"], "after");
    assert_eq!(suggestion["line"], 5);
    assert_eq!(suggestion["text"], "needle line");
    // Asking stores nothing.
    let (_, view) = discuss(address, &file, json!(null));
    assert_eq!(thread(&view)["anchor"]["target"]["start"], 3);

    // Confirming is the validated move, guarded by the suggested text.
    let revision = current_revision(address, &file);
    let (status, moved) = discuss(
        address,
        &file,
        json!({"kind": "move", "id": id, "revision": thread(&view)["revision"],
               "anchor": anchor(&file, "after", 5, &revision), "if_text": suggestion["text"]}),
    );
    assert_eq!(status, 200, "{moved}");
    assert_eq!(thread(&moved)["anchor"]["target"]["start"], 5);
    assert_eq!(thread(&moved)["anchor"]["revision"], revision);
    assert_eq!(thread(&moved)["anchor"]["quote"], "needle line");
    assert_eq!(relocate(address, &file, id)["outcome"], "current");
}

#[test]
fn a_duplicate_or_missing_match_is_never_guessed() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address, file, id) = quoted_thread(scratch.path());
    write_after(
        scratch.path(),
        &[
            "one",
            "needle line",
            "two",
            "needle line",
            "four",
            "five",
            "SIX",
            "eight",
        ],
    );
    let duplicate = relocate(address, &file, id);
    assert_eq!(duplicate["outcome"], "ambiguous");
    assert!(duplicate.get("line").is_none());

    write_after(
        scratch.path(),
        &[
            "one",
            "two",
            "needle lines",
            "four",
            "five",
            "SIX",
            "seven",
            "eight",
        ],
    );
    assert_eq!(
        relocate(address, &file, id)["outcome"],
        "missing",
        "a reworded line is not matched"
    );

    let (_, view) = discuss(address, &file, json!(null));
    assert_eq!(
        thread(&view)["anchor"]["target"]["start"],
        3,
        "the thread stays stale where it was"
    );
}

#[test]
fn a_match_the_diff_hides_is_reported_and_not_offered() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path());
    // A long file where the only match is far from every change, so the diff does not show it.
    let folder = scratch.path().join("pair");
    fs::create_dir_all(&folder).unwrap();
    let mut before: Vec<String> = (1..=30).map(|number| format!("line {number}")).collect();
    before[24] = "needle line".into();
    fs::write(folder.join("before.txt"), before.join("\n") + "\n").unwrap();
    let mut after = before.clone();
    after[2] = "needle line".into();
    fs::write(folder.join("after.txt"), after.join("\n") + "\n").unwrap();
    let mut file = Fixture {
        selection: json!({
            "source": {"kind": "paths", "before": folder.join("before.txt"), "after": folder.join("after.txt")},
            "index": 0,
            "path": "after.txt",
        }),
        revision: String::new(),
    };
    file.revision = current_revision(address, &file);
    let (status, created) = discuss(
        address,
        &file,
        json!({"kind": "create", "anchor": anchor(&file, "after", 3, &file.revision),
               "category": "note", "author": "Reviewer", "markdown": "Hidden match."}),
    );
    assert_eq!(status, 200, "{created}");
    let id = thread(&created)["id"].as_u64().unwrap();

    // Line 3 is reverted and line 12 changed instead: the match at line 25 is unchanged and outside the hunk.
    let mut later = before.clone();
    later[11] = "changed".into();
    fs::write(folder.join("after.txt"), later.join("\n") + "\n").unwrap();
    let outcome = relocate(address, &file, id);
    assert_eq!(outcome["outcome"], "hidden");
    assert!(outcome.get("line").is_none());
}

#[test]
fn a_destination_that_changed_after_the_suggestion_is_refused() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address, file, id) = quoted_thread(scratch.path());
    write_after(
        scratch.path(),
        &[
            "one",
            "two",
            "four",
            "five",
            "needle line",
            "SIX",
            "seven",
            "eight",
        ],
    );
    let suggestion = relocate(address, &file, id);
    assert_eq!(suggestion["outcome"], "suggestion");
    // The file changes again: line 5 now reads something else.
    write_after(
        scratch.path(),
        &[
            "one",
            "two",
            "four",
            "five",
            "other text",
            "SIX",
            "seven",
            "eight",
        ],
    );
    let revision = current_revision(address, &file);
    let (_, view) = discuss(address, &file, json!(null));
    let (status, body) = discuss(
        address,
        &file,
        json!({"kind": "move", "id": id, "revision": thread(&view)["revision"],
               "anchor": anchor(&file, "after", 5, &revision), "if_text": suggestion["text"]}),
    );
    assert_eq!(status, 409, "{body}");
    let (_, after) = discuss(address, &file, json!(null));
    assert_eq!(thread(&after)["anchor"]["target"]["start"], 3);
    let (status, _) = post(
        address,
        "discussion/relocate",
        &json!({"selection": file.selection, "thread": 999}),
    );
    assert_eq!(status, 400, "an unknown thread is refused");
}

// HS2-A07MHD: the host publishes the documented JSON export next to the Markdown handoff.

fn find_export(root: &Path) -> Option<std::path::PathBuf> {
    for entry in fs::read_dir(root).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_export(&path) {
                return Some(found);
            }
        } else if path.file_name().is_some_and(|name| name == "feedback.json") {
            return Some(path);
        }
    }
    None
}

#[test]
fn a_comment_made_through_the_host_appears_in_the_json_export() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path());
    let file = fixture(scratch.path(), address);
    let (status, created) = discuss(
        address,
        &file,
        json!({"kind": "create", "anchor": anchor(&file, "after", 3, &file.revision),
               "category": "bug", "author": "Reviewer", "markdown": "Exported."}),
    );
    assert_eq!(status, 200, "{created}");
    let path =
        find_export(&scratch.path().join("feedback")).expect("feedback.json beside review.md");
    assert!(path.with_file_name("review.md").is_file());
    let export: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(export["schema_version"], 1);
    let exported = &export["threads"][0];
    assert_eq!(exported["file"], "after.txt");
    assert_eq!(exported["side"], "after");
    assert_eq!(exported["revision"], file.revision);
    assert_eq!(
        exported["target"],
        json!({"kind": "line", "start": 3, "end": 3})
    );
    assert_eq!(exported["line_text"], "THREE");
    assert_eq!(
        exported["origin"],
        json!({"kind": "reviewer", "category": "bug"})
    );
    assert_eq!(exported["messages"][0]["markdown"], "Exported.");

    // A move is exported with the thread's new place.
    let (_, view) = discuss(address, &file, json!(null));
    let (status, _) = discuss(
        address,
        &file,
        json!({"kind": "move", "id": thread(&view)["id"], "revision": thread(&view)["revision"],
               "anchor": anchor(&file, "after", 4, &file.revision)}),
    );
    assert_eq!(status, 200);
    let path = find_export(&scratch.path().join("feedback")).unwrap();
    let export: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(export["threads"][0]["target"]["start"], 4);
    assert_eq!(export["threads"][0]["line_text"], "four");
}

// HS2-9MZ32M: an image region moves and resizes through the same validated Move, and covers a whole image.

struct Images {
    selection: Value,
    before_revision: String,
    after_revision: String,
}

fn images(root: &Path, address: SocketAddr) -> Images {
    let folder = root.join("art");
    fs::create_dir_all(&folder).unwrap();
    let svg = |fill: &str| {
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="{fill}"/></svg>"#
        )
    };
    let (before, after) = (folder.join("before.svg"), folder.join("after.svg"));
    fs::write(&before, svg("#506b91")).unwrap();
    fs::write(&after, svg("#3b7c68")).unwrap();
    let selection = json!({
        "source": {"kind": "paths", "before": before, "after": after},
        "index": 0,
        "path": "after.svg",
    });
    let (status, file) = post(address, "file", &selection);
    assert_eq!(status, 200, "{file}");
    Images {
        selection,
        before_revision: file["before"]["revision"].as_str().unwrap().to_owned(),
        after_revision: file["after"]["revision"].as_str().unwrap().to_owned(),
    }
}

fn region(side: &str, revision: &str, left: f64, top: f64, width: f64, height: f64) -> Value {
    json!({"path": "after.svg", "side": side, "revision": revision,
           "target": {"kind": "image_region", "left": left, "top": top, "width": width, "height": height}})
}

fn discuss_images(address: SocketAddr, art: &Images, operation: Value) -> (u16, Value) {
    post(
        address,
        "discussion",
        &json!({"selection": art.selection, "operation": operation}),
    )
}

#[test]
fn a_region_moves_resizes_and_covers_the_whole_image_on_either_side() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path());
    let art = images(scratch.path(), address);
    let (status, created) = discuss_images(
        address,
        &art,
        json!({"kind": "create", "anchor": region("after", &art.after_revision, 0.1, 0.1, 0.2, 0.2),
               "category": "note", "author": "Reviewer", "markdown": "The circle is off."}),
    );
    assert_eq!(status, 200, "{created}");
    let id = thread(&created)["id"].as_u64().unwrap();
    let (_, replied) = discuss_images(
        address,
        &art,
        json!({"kind": "apply", "id": id, "revision": thread(&created)["revision"],
               "change": {"kind": "reply", "author": "Author", "markdown": "Fixed."}}),
    );

    // Moved and resized, replies and text kept.
    let (status, moved) = discuss_images(
        address,
        &art,
        json!({"kind": "move", "id": id, "revision": thread(&replied)["revision"],
               "anchor": region("after", &art.after_revision, 0.5, 0.25, 0.4, 0.5)}),
    );
    assert_eq!(status, 200, "{moved}");
    assert_eq!(thread(&moved)["anchor"]["target"]["left"], 0.5);
    assert_eq!(thread(&moved)["anchor"]["target"]["height"], 0.5);
    assert_eq!(thread(&moved)["replies"].as_array().map(Vec::len), Some(1));
    assert_eq!(thread(&moved)["opening"]["markdown"], "The circle is off.");
    assert!(thread(&moved)["anchor"].get("quote").is_none());

    // The whole image is the full region.
    let (status, whole) = discuss_images(
        address,
        &art,
        json!({"kind": "move", "id": id, "revision": thread(&moved)["revision"],
               "anchor": region("after", &art.after_revision, 0.0, 0.0, 1.0, 1.0)}),
    );
    assert_eq!(status, 200, "{whole}");
    assert_eq!(thread(&whole)["anchor"]["target"]["width"], 1.0);

    // The before side has its own regions and its own revision.
    let (status, before) = discuss_images(
        address,
        &art,
        json!({"kind": "create", "anchor": region("before", &art.before_revision, 0.0, 0.0, 1.0, 1.0),
               "category": "note", "author": "Reviewer", "markdown": "The old image."}),
    );
    assert_eq!(status, 200, "{before}");
    assert_ne!(art.before_revision, art.after_revision);
}

#[test]
fn a_refused_region_leaves_the_thread_as_it_was() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path());
    let art = images(scratch.path(), address);
    let (_, created) = discuss_images(
        address,
        &art,
        json!({"kind": "create", "anchor": region("after", &art.after_revision, 0.1, 0.1, 0.2, 0.2),
               "category": "note", "author": "Reviewer", "markdown": "Region."}),
    );
    let id = thread(&created)["id"].as_u64().unwrap();
    let revision = thread(&created)["revision"].clone();
    let refuse = |anchor: Value, expected: u16| {
        let (status, body) = discuss_images(
            address,
            &art,
            json!({"kind": "move", "id": id, "revision": revision, "anchor": anchor}),
        );
        assert_eq!(status, expected, "{body}");
    };
    // Out of bounds, empty, and negative regions fail the model's bounds.
    refuse(
        region("after", &art.after_revision, 0.9, 0.1, 0.3, 0.2),
        400,
    );
    refuse(
        region("after", &art.after_revision, 0.1, 0.1, 0.0, 0.2),
        400,
    );
    refuse(
        region("after", &art.after_revision, -0.1, 0.1, 0.2, 0.2),
        400,
    );
    // A revision the image no longer has, the other side, and a line destination are not region moves.
    refuse(region("after", "stale", 0.2, 0.2, 0.2, 0.2), 409);
    refuse(
        region("before", &art.before_revision, 0.2, 0.2, 0.2, 0.2),
        400,
    );
    refuse(
        json!({"path": "after.svg", "side": "after", "revision": art.after_revision,
               "target": {"kind": "line", "start": 1, "end": 1}}),
        400,
    );
    let (status, view) = discuss_images(address, &art, json!(null));
    assert_eq!(status, 200);
    assert_eq!(thread(&view)["anchor"]["target"]["left"], 0.1);
    assert_eq!(thread(&view)["revision"], revision);

    // The image changes: the saved region keeps its old revision and the move to it is refused.
    let after = scratch.path().join("art").join("after.svg");
    fs::write(
        &after,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="9" height="9"/></svg>"#,
    )
    .unwrap();
    refuse(
        region("after", &art.after_revision, 0.2, 0.2, 0.2, 0.2),
        409,
    );
}

// GB2-5QQPPW: an unchanged line the diff does not show is still a line of the file, so it takes a comment.

#[test]
fn a_comment_anchors_to_an_unchanged_line_outside_the_hunks_but_not_past_the_end() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path());
    let folder = scratch.path().join("pair");
    fs::create_dir_all(&folder).unwrap();
    let before: Vec<String> = (1..=30).map(|number| format!("line {number}")).collect();
    let mut after = before.clone();
    after[2] = "changed 3".into();
    fs::write(folder.join("before.txt"), before.join("\n") + "\n").unwrap();
    fs::write(folder.join("after.txt"), after.join("\n")).unwrap();
    let mut file = Fixture {
        selection: json!({
            "source": {"kind": "paths", "before": folder.join("before.txt"), "after": folder.join("after.txt")},
            "index": 0,
            "path": "after.txt",
        }),
        revision: String::new(),
    };
    file.revision = current_revision(address, &file);
    let create = |side: &str, line: u32| {
        discuss(
            address,
            &file,
            json!({"kind": "create", "anchor": anchor(&file, side, line, &file.revision),
                   "category": "note", "author": "Reviewer", "markdown": "On an unchanged line."}),
        )
    };

    // Line 20 is far from the one change, on either side, and the host records its text.
    let (status, after_side) = create("after", 20);
    assert_eq!(status, 200, "{after_side}");
    assert_eq!(thread(&after_side)["anchor"]["quote"], "line 20");
    let (status, both) = create("before", 21);
    assert_eq!(status, 200, "{both}");
    assert_eq!(both["threads"].as_array().map(Vec::len), Some(2));

    // The last line, even without a final newline, is a line; the one after it is not.
    let (status, last) = create("after", 30);
    assert_eq!(status, 200, "{last}");
    assert_eq!(last["threads"][2]["anchor"]["quote"], "line 30");
    assert_eq!(create("after", 31).0, 409);
    assert_eq!(create("before", 31).0, 409);
    assert_eq!(create("after", 0).0, 409);

    // A revision the file no longer has still refuses, whatever the line.
    let (status, _) = discuss(
        address,
        &file,
        json!({"kind": "create", "anchor": anchor(&file, "after", 20, "stale"),
               "category": "note", "author": "Reviewer", "markdown": "Stale."}),
    );
    assert_eq!(status, 409);

    // A comment moves onto an unchanged line too, and takes its text.
    let id = last["threads"][0]["id"].as_u64().unwrap();
    let (status, moved) = discuss(
        address,
        &file,
        json!({"kind": "move", "id": id, "revision": last["threads"][0]["revision"],
               "anchor": anchor(&file, "after", 25, &file.revision)}),
    );
    assert_eq!(status, 200, "{moved}");
    assert_eq!(moved["threads"][0]["anchor"]["quote"], "line 25");
}
