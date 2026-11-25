// HS2-M7CXQV: the terminal launcher opens the default browser only when asked, and only once the
// host is ready. The system opener is a recording shim found through PATH (Unix only; the Windows
// launcher cannot be shimmed because System32 wins over PATH).
#![cfg(unix)]

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const OPENER: &str = if cfg!(target_os = "macos") {
    "open"
} else {
    "xdg-open"
};

fn shim(directory: &Path) {
    let script = directory.join(OPENER);
    std::fs::write(
        &script,
        format!(
            "#!/bin/sh\nprintf '%s|%s\\n' \"$#\" \"$1\" >> '{}'\n",
            directory.join("opened.log").display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn launch(directory: &Path, args: &[&str]) -> Child {
    Command::new(env!("CARGO_BIN_EXE_glassbox-server"))
        .args(args)
        .env("PATH", directory)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

fn address(child: &mut Child) -> String {
    let mut line = String::new();
    BufReader::new(child.stdout.as_mut().unwrap())
        .read_line(&mut line)
        .unwrap();
    line.trim().to_owned()
}

fn health(address: &str) -> String {
    let mut connection = TcpStream::connect(address).unwrap();
    connection
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    connection
        .write_all(
            format!("GET /api/v1/health HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .unwrap();
    let mut response = String::new();
    connection.read_to_string(&mut response).unwrap();
    response
}

fn opened(directory: &Path) -> Vec<String> {
    std::fs::read_to_string(directory.join("opened.log"))
        .map(|text| text.lines().map(str::to_owned).collect())
        .unwrap_or_default()
}

fn wait_for_open(directory: &Path) -> Vec<String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let lines = opened(directory);
        if !lines.is_empty() {
            return lines;
        }
        assert!(Instant::now() < deadline, "the browser was never opened");
        std::thread::sleep(Duration::from_millis(20));
    }
}

#[test]
fn the_open_option_opens_the_ready_host_once() {
    let directory = tempfile::tempdir().unwrap();
    shim(directory.path());
    let mut host = launch(directory.path(), &["--open"]);
    let address = address(&mut host);
    let lines = wait_for_open(directory.path());
    assert_eq!(lines, [format!("1|http://{address}/")]);
    assert!(health(&address).starts_with("HTTP/1.1 200"));
    host.kill().unwrap();
    host.wait().unwrap();
}

#[test]
fn a_launch_without_the_option_stays_headless() {
    let directory = tempfile::tempdir().unwrap();
    shim(directory.path());
    let mut host = launch(directory.path(), &[]);
    let address = address(&mut host);
    assert!(health(&address).starts_with("HTTP/1.1 200"));
    std::thread::sleep(Duration::from_millis(500));
    assert_eq!(opened(directory.path()), Vec::<String>::new());
    host.kill().unwrap();
    host.wait().unwrap();
}

#[test]
fn a_startup_failure_opens_no_browser() {
    let directory = tempfile::tempdir().unwrap();
    shim(directory.path());
    let output = launch(directory.path(), &["--open", "--difftool", "only-one-path"])
        .wait_with_output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("--difftool"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(opened(directory.path()), Vec::<String>::new());
}

#[test]
fn a_browser_that_cannot_be_opened_does_not_stop_the_host() {
    let directory = tempfile::tempdir().unwrap();
    let mut host = launch(directory.path(), &["--open"]);
    let address = address(&mut host);
    assert!(health(&address).starts_with("HTTP/1.1 200"));
    host.kill().unwrap();
    let output = host.wait_with_output().unwrap();
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("Could not open"),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
