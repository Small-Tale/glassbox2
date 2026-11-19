use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use glassbox_model::{DifftoolInput, ServiceHealth};

struct RunningServer(Child);

impl Drop for RunningServer {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl RunningServer {
    fn start(assets: Option<&Path>) -> (Self, SocketAddr) {
        Self::start_with_args(assets, &[])
    }

    fn start_with_args(assets: Option<&Path>, args: &[&OsStr]) -> (Self, SocketAddr) {
        let mut command = Command::new(env!("CARGO_BIN_EXE_glassbox-server"));
        if let Some(path) = assets {
            command.arg("--assets").arg(path);
        }
        let child = command
            .args(args)
            .stdout(Stdio::piped())
            .spawn()
            .expect("start Glassbox service");
        let mut server = Self(child);
        let stdout = server.0.stdout.take().expect("capture service stdout");
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
        (server, address)
    }
}

fn get(address: SocketAddr, path: &str) -> String {
    request(address, path, &address.to_string(), "")
}

fn request(address: SocketAddr, path: &str, host: &str, extra_headers: &str) -> String {
    let timeout = Duration::from_secs(5);
    let mut connection = TcpStream::connect_timeout(&address, timeout).unwrap();
    connection.set_read_timeout(Some(timeout)).unwrap();
    connection.set_write_timeout(Some(timeout)).unwrap();
    write!(
        connection,
        "GET {path} HTTP/1.1\r\nHost: {host}\r\n{extra_headers}Connection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    connection.read_to_string(&mut response).unwrap();
    response
}

#[test]
fn health_is_available_through_the_real_loopback_service() {
    let (_server, address) = RunningServer::start(None);
    assert!(IpAddr::is_loopback(&address.ip()));

    let response = get(address, "/api/v1/health");
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    assert!(headers.starts_with("HTTP/1.1 200 OK"));
    assert!(headers.contains("content-type: application/json"));
    assert_eq!(
        serde_json::from_str::<ServiceHealth>(body).unwrap(),
        ServiceHealth::ready()
    );
    assert!(get(address, "/api/v2/health").starts_with("HTTP/1.1 404 Not Found"));
}

#[test]
fn built_pages_and_assets_are_served_by_the_same_application_origin() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("ux-demo")).unwrap();
    std::fs::write(
        directory.path().join("index.html"),
        "<title>Glassbox</title>",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("ux-demo/index.html"),
        "<title>Catalog</title>",
    )
    .unwrap();
    std::fs::write(directory.path().join("app.js"), "console.log('Glassbox');").unwrap();
    let (_host, address) = RunningServer::start(Some(directory.path()));
    assert!(get(address, "/").contains("<title>Glassbox</title>"));
    assert!(get(address, "/ux-demo/").contains("<title>Catalog</title>"));
    let js = get(address, "/app.js");
    assert!(js.starts_with("HTTP/1.1 200 OK"));
    assert!(js.contains("javascript"));
    assert_eq!(
        request(address, "/api/v1/health", "host.example.test", "")
            .lines()
            .next(),
        Some("HTTP/1.1 403 Forbidden")
    );
    let disallowed = [
        "Origin: https://example.test\r\n",
        "Sec-Fetch-Site: cross-site\r\n",
    ];
    for extra in disallowed {
        assert!(
            request(address, "/api/v1/health", &address.to_string(), extra)
                .starts_with("HTTP/1.1 403 Forbidden")
        );
    }
}

#[tokio::test]
async fn embedding_host_releases_its_listener_when_stopped() {
    let host = glassbox_server::LocalHost::start(None).await.unwrap();
    let address = host.address();
    assert!(tokio::net::TcpListener::bind(address).await.is_err());
    host.stop().await.unwrap();
    let _replacement = tokio::net::TcpListener::bind(address)
        .await
        .expect("the stopped host releases its listener");
}

#[test]
fn difftool_input_is_only_published_for_a_difftool_launch() {
    let (_ordinary, ordinary_address) = RunningServer::start(None);
    assert!(get(ordinary_address, "/api/v1/difftool").starts_with("HTTP/1.1 404 Not Found"));

    let before = OsStr::new("before with spaces & punctuation");
    let after = OsStr::new("after with spaces & punctuation");
    let (_server, address) =
        RunningServer::start_with_args(None, &[OsStr::new("--difftool"), before, after]);
    let response = get(address, "/api/v1/difftool");
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    assert!(headers.starts_with("HTTP/1.1 200 OK"));
    let input = serde_json::from_str::<DifftoolInput>(body).unwrap();
    assert_eq!(input.before, std::path::absolute(before).unwrap());
    assert_eq!(input.after, std::path::absolute(after).unwrap());
    assert!(
        request(
            address,
            "/api/v1/difftool",
            &address.to_string(),
            "Origin: https://example.test\r\n"
        )
        .starts_with("HTTP/1.1 403 Forbidden")
    );
}
