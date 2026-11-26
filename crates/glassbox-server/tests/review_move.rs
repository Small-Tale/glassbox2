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
