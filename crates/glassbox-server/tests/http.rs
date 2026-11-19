use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use glassbox_model::ServiceHealth;

struct RunningServer(Child);

impl Drop for RunningServer {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl RunningServer {
    fn start() -> (Self, SocketAddr) {
        let child = Command::new(env!("CARGO_BIN_EXE_glassbox-server"))
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
    let timeout = Duration::from_secs(5);
    let mut connection = TcpStream::connect_timeout(&address, timeout).unwrap();
    connection.set_read_timeout(Some(timeout)).unwrap();
    connection.set_write_timeout(Some(timeout)).unwrap();
    write!(
        connection,
        "GET {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    let mut response = String::new();
    connection.read_to_string(&mut response).unwrap();
    response
}

#[test]
fn health_is_available_through_the_real_loopback_service() {
    let (_server, address) = RunningServer::start();
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
