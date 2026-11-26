//! HS2-FTEQVQ: per-file review progress against the real host, its stored marks and a changing file.

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

fn start(settings: &Path) -> (Host, SocketAddr) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_glassbox-server"))
        .env("GLASSBOX_SETTINGS_DIRECTORY", settings)
        .env("GLASSBOX_FEEDBACK_DIRECTORY", settings.join("feedback"))
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

struct Pair {
    source: Value,
    after: std::path::PathBuf,
}

fn pair(root: &Path, name: &str, before: &str, after: &str) -> Pair {
    let folder = root.join(name);
    fs::create_dir_all(&folder).unwrap();
    let (before_path, after_path) = (folder.join("before.txt"), folder.join("after.txt"));
    fs::write(&before_path, before).unwrap();
    fs::write(&after_path, after).unwrap();
    Pair {
        source: json!({"kind": "paths", "before": before_path, "after": after_path}),
        after: after_path,
    }
}

fn selection(pair: &Pair) -> Value {
    json!({"source": pair.source, "index": 0, "path": "after.txt"})
}

fn revision(address: SocketAddr, pair: &Pair) -> String {
    let (status, file) = post(address, "file", &selection(pair));
    assert_eq!(status, 200);
    file["revision"].as_str().unwrap().to_owned()
}

fn mark(address: SocketAddr, pair: &Pair, revision: &str, reviewed: bool) -> u16 {
    let mut input = selection(pair);
    input["revision"] = json!(revision);
    input["reviewed"] = json!(reviewed);
    post(address, "progress/mark", &input).0
}

fn progress(address: SocketAddr, pair: &Pair) -> Value {
    let (status, view) = post(address, "progress", &json!({"source": pair.source}));
    assert_eq!(status, 200);
    view["files"].clone()
}

#[test]
fn marks_persist_per_comparison_and_stop_counting_when_the_file_changes() {
    let scratch = tempfile::tempdir().unwrap();
    let settings = scratch.path().join("settings");
    let first = pair(scratch.path(), "first", "one\ntwo\n", "one\nTWO\n");
    let second = pair(scratch.path(), "second", "alpha\n", "beta\n");
    let (host, address) = start(&settings);

    assert_eq!(progress(address, &first), json!([]));
    let current = revision(address, &first);
    assert_eq!(mark(address, &first, &current, true), 200);
    assert_eq!(
        progress(address, &first),
        json!([{"path": "after.txt", "state": "reviewed"}])
    );
    assert_eq!(
        progress(address, &second),
        json!([]),
        "another comparison is unmarked"
    );

    // Reopening the host keeps the mark with the comparison it belongs to.
    drop(host);
    let (_host, address) = start(&settings);
    assert_eq!(
        progress(address, &first),
        json!([{"path": "after.txt", "state": "reviewed"}])
    );
    assert_eq!(progress(address, &second), json!([]));

    // A mark against a revision the file no longer has is refused and stores nothing.
    fs::write(&first.after, "one\nTWO\nthree\n").unwrap();
    assert_eq!(
        progress(address, &first),
        json!([{"path": "after.txt", "state": "changed"}]),
        "a changed file is no longer counted as reviewed"
    );
    assert_eq!(mark(address, &first, &current, true), 409);
    assert_eq!(
        progress(address, &first),
        json!([{"path": "after.txt", "state": "changed"}])
    );

    // Marking the new content reviews it again; clearing a mark removes it.
    let changed = revision(address, &first);
    assert_ne!(changed, current);
    assert_eq!(mark(address, &first, &changed, true), 200);
    assert_eq!(
        progress(address, &first),
        json!([{"path": "after.txt", "state": "reviewed"}])
    );
    assert_eq!(mark(address, &first, &changed, false), 200);
    assert_eq!(progress(address, &first), json!([]));
    assert_eq!(
        mark(address, &first, "stale", false),
        200,
        "clearing needs no revision"
    );
}

#[test]
fn a_mark_for_a_file_outside_the_comparison_is_refused() {
    let scratch = tempfile::tempdir().unwrap();
    let only = pair(scratch.path(), "only", "a\n", "b\n");
    let (_host, address) = start(&scratch.path().join("settings"));
    let mut input = selection(&only);
    input["path"] = json!("elsewhere.txt");
    input["revision"] = json!("x");
    input["reviewed"] = json!(true);
    assert_eq!(post(address, "progress/mark", &input).0, 400);
    assert_eq!(progress(address, &only), json!([]));
}
