//! HS2-3G613V: safe attachment previews and the explicit external open, against the real host.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use base64::prelude::*;
use serde_json::{Value, json};

struct Host(Child);

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn start(root: &Path, opener: Option<&Path>) -> (Host, SocketAddr) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_glassbox-server"));
    command
        .env("GLASSBOX_SETTINGS_DIRECTORY", root.join("settings"))
        .env("GLASSBOX_FEEDBACK_DIRECTORY", root.join("feedback"))
        .stdout(Stdio::piped());
    if let Some(opener) = opener {
        command.env("GLASSBOX_ATTACHMENT_OPENER", opener);
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

struct Reply {
    status: u16,
    headers: String,
    body: Vec<u8>,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;
            key.eq_ignore_ascii_case(name).then(|| value.trim())
        })
    }

    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
}

fn post(address: SocketAddr, endpoint: &str, input: &Value) -> Reply {
    let body = input.to_string();
    let timeout = Duration::from_secs(10);
    let mut connection = TcpStream::connect_timeout(&address, timeout).unwrap();
    connection.set_read_timeout(Some(timeout)).unwrap();
    let request = format!(
        "POST /api/v1/review/{endpoint} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    connection.write_all(request.as_bytes()).unwrap();
    let mut response = Vec::new();
    connection.read_to_end(&mut response).unwrap();
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap();
    let headers = String::from_utf8_lossy(&response[..split]).into_owned();
    let status = headers.split_whitespace().nth(1).unwrap().parse().unwrap();
    Reply {
        status,
        headers,
        body: response[split + 4..].to_vec(),
    }
}

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4];
const PDF: &[u8] = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n";

struct Fixture {
    selection: Value,
    thread: u64,
    ids: Vec<(String, u64)>,
}

/// A thread whose opening message carries each of `files` as an attachment.
fn fixture(root: &Path, address: SocketAddr, files: &[(&str, &[u8])]) -> Fixture {
    let folder = root.join("pair");
    fs::create_dir_all(&folder).unwrap();
    let (before, after) = (folder.join("before.txt"), folder.join("after.txt"));
    fs::write(&before, "one\ntwo\n").unwrap();
    fs::write(&after, "one\nTWO\n").unwrap();
    let selection = json!({
        "source": {"kind": "paths", "before": before, "after": after},
        "index": 0,
        "path": "after.txt",
    });
    let file = post(address, "file", &selection).json();
    let revision = file["revision"].as_str().unwrap().to_owned();
    let discuss = |operation: Value| {
        let reply = post(
            address,
            "discussion",
            &json!({"selection": selection, "operation": operation}),
        );
        assert_eq!(
            reply.status,
            200,
            "{}",
            String::from_utf8_lossy(&reply.body)
        );
        reply.json()
    };
    let mut view = discuss(
        json!({"kind": "create", "category": "note", "author": "Reviewer",
        "markdown": "See attached.",
        "anchor": {"path": "after.txt", "side": "after", "revision": revision,
                   "target": {"kind": "line", "start": 2, "end": 2}}}),
    );
    let thread = view["threads"][0]["id"].as_u64().unwrap();
    for (name, bytes) in files {
        view = discuss(json!({"kind": "attach", "id": thread,
            "revision": view["threads"][0]["revision"], "filename": name,
            "content": BASE64_STANDARD.encode(bytes)}));
    }
    let ids = view["threads"][0]["opening"]["attachments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            (
                item["filename"].as_str().unwrap().to_owned(),
                item["id"].as_u64().unwrap(),
            )
        })
        .collect();
    Fixture {
        selection,
        thread,
        ids,
    }
}

fn input(file: &Fixture, attachment: u64) -> Value {
    json!({"selection": file.selection, "thread": file.thread, "attachment": attachment})
}

fn id_of(file: &Fixture, name: &str) -> u64 {
    file.ids.iter().find(|(item, _)| item == name).unwrap().1
}

const SAMPLE: &[(&str, &[u8])] = &[
    ("shot.png", PNG),
    ("report.pdf", PDF),
    ("renamed.jpg", PNG),
    (
        "drawing.svg",
        b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>",
    ),
    ("notes.txt", b"plain"),
];

#[test]
fn the_thread_view_marks_only_verified_attachments_as_previewable_and_openable() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path(), None);
    let file = fixture(scratch.path(), address, SAMPLE);
    let view = post(
        address,
        "discussion",
        &json!({"selection": file.selection, "operation": null}),
    )
    .json();
    let attachments = view["threads"][0]["opening"]["attachments"]
        .as_array()
        .unwrap();
    let by_name = |name: &str| {
        attachments
            .iter()
            .find(|item| item["filename"] == name)
            .unwrap()
    };
    assert_eq!(by_name("shot.png")["preview"], "image");
    assert_eq!(by_name("shot.png")["openable"], true);
    assert_eq!(by_name("report.pdf")["preview"], "pdf");
    assert_eq!(by_name("report.pdf")["openable"], true);
    for name in ["renamed.jpg", "drawing.svg", "notes.txt"] {
        assert!(by_name(name).get("preview").is_none(), "{name}");
        assert_eq!(by_name(name)["openable"], false, "{name}");
    }
}

#[test]
fn previews_serve_verified_bytes_with_locked_down_headers_and_refuse_the_rest() {
    let scratch = tempfile::tempdir().unwrap();
    let (_host, address) = start(scratch.path(), None);
    let file = fixture(scratch.path(), address, SAMPLE);

    let image = post(
        address,
        "discussion/attachment",
        &input(&file, id_of(&file, "shot.png")),
    );
    assert_eq!(image.status, 200);
    assert_eq!(image.header("content-type"), Some("image/png"));
    assert_eq!(image.header("x-content-type-options"), Some("nosniff"));
    assert_eq!(image.header("content-security-policy"), Some("sandbox"));
    assert_eq!(image.header("cache-control"), Some("no-store"));
    assert_eq!(image.body, PNG);

    let document = post(
        address,
        "discussion/attachment",
        &input(&file, id_of(&file, "report.pdf")),
    );
    assert_eq!(document.status, 200);
    assert_eq!(document.header("content-type"), Some("application/pdf"));
    assert_eq!(document.body, PDF);

    for name in ["renamed.jpg", "drawing.svg", "notes.txt"] {
        let refused = post(
            address,
            "discussion/attachment",
            &input(&file, id_of(&file, name)),
        );
        assert_eq!(refused.status, 415, "{name}");
        assert_ne!(refused.body, PNG, "{name}");
    }

    let missing = post(address, "discussion/attachment", &input(&file, 9999));
    assert_eq!(missing.status, 404);
    let mut other_thread = input(&file, id_of(&file, "shot.png"));
    other_thread["thread"] = json!(9999);
    assert_eq!(
        post(address, "discussion/attachment", &other_thread).status,
        404
    );
}

#[cfg(unix)]
#[test]
fn open_launches_a_private_copy_of_a_verified_attachment_only() {
    use std::os::unix::fs::PermissionsExt;

    let scratch = tempfile::tempdir().unwrap();
    let log = scratch.path().join("opened.log");
    let opener = scratch.path().join("opener.sh");
    fs::write(
        &opener,
        format!("#!/bin/sh\necho \"$1\" >> '{}'\n", log.display()),
    )
    .unwrap();
    fs::set_permissions(&opener, fs::Permissions::from_mode(0o755)).unwrap();
    let (_host, address) = start(scratch.path(), Some(&opener));
    let file = fixture(scratch.path(), address, SAMPLE);

    for name in ["renamed.jpg", "drawing.svg", "notes.txt"] {
        let refused = post(
            address,
            "discussion/attachment/open",
            &input(&file, id_of(&file, name)),
        );
        assert_eq!(refused.status, 415, "{name}");
    }
    assert_eq!(
        post(address, "discussion/attachment/open", &input(&file, 9999)).status,
        404
    );

    let id = id_of(&file, "shot.png");
    let opened = post(address, "discussion/attachment/open", &input(&file, id));
    assert_eq!(opened.status, 200);
    assert_eq!(opened.json()["opened"], true);

    let launched = (0..200)
        .find_map(|_| {
            std::thread::sleep(Duration::from_millis(25));
            fs::read_to_string(&log)
                .ok()
                .filter(|text| !text.is_empty())
        })
        .expect("the opener ran");
    let lines: Vec<_> = launched.lines().collect();
    assert_eq!(
        lines.len(),
        1,
        "only the verified attachment launched: {lines:?}"
    );
    let path = Path::new(lines[0]);
    assert_eq!(
        path.file_name().unwrap(),
        format!("attachment-{id}.png").as_str()
    );
    assert!(
        !lines[0].contains("shot"),
        "the person's filename never reaches the launcher"
    );
    assert_eq!(fs::read(path).unwrap(), PNG);
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    let _ = fs::remove_dir_all(path.parent().unwrap());
}
