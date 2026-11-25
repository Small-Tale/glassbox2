#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

use glassbox_server::{DifftoolInput, LocalHost};
use tauri::webview::NewWindowResponse;
use tauri::{Manager, Url, WebviewUrl, WebviewWindowBuilder};

/// What the review window does with a navigation or a new-window request (HS2-E6C9C9).
#[derive(Debug, PartialEq, Eq)]
enum Navigation {
    /// The local review client itself.
    Stay,
    /// A web link: hand it to the system default browser and keep the review window in place.
    OpenInBrowser,
    /// Anything else (other schemes, files, scripts) goes nowhere.
    Block,
}

fn navigation(target: &Url, local: &Url) -> Navigation {
    if target.origin() == local.origin() {
        Navigation::Stay
    } else if matches!(target.scheme(), "http" | "https") && target.has_host() {
        Navigation::OpenInBrowser
    } else {
        Navigation::Block
    }
}

fn route_external(target: &Url, local: &Url) -> bool {
    match navigation(target, local) {
        Navigation::Stay => true,
        Navigation::OpenInBrowser => {
            if let Err(error) = glassbox_server::browser::open_in_browser(target.as_str()) {
                eprintln!("Could not open {target} in the default browser: {error}");
            }
            false
        }
        Navigation::Block => false,
    }
}

fn main() -> tauri::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let difftool = launch_input(&args)?;
    tauri::Builder::default()
        .setup(move |app| {
            let assets = if cfg!(debug_assertions) {
                development_assets()
            } else {
                app.path().resource_dir()?.join("web")
            };
            let host = start_host(&assets, difftool)?;
            let url: tauri::Url = format!("http://{}/", host.address()).parse()?;
            let local = url.clone();
            app.manage(host);
            let window_local = url.clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .on_navigation(move |target| route_external(target, &local))
                .on_new_window(move |target, _| {
                    route_external(&target, &window_local);
                    NewWindowResponse::Deny
                })
                .title("Glassbox")
                .inner_size(1200.0, 800.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
}

fn development_assets() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
}

fn launch_input(args: &[OsString]) -> io::Result<Option<DifftoolInput>> {
    (!args.is_empty())
        .then(|| DifftoolInput::from_arguments(args))
        .transpose()
}

fn start_host(assets: &Path, difftool: Option<DifftoolInput>) -> io::Result<LocalHost> {
    tauri::async_runtime::block_on(LocalHost::start_with_difftool(Some(assets), difftool))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::time::Duration;

    fn get(host: &LocalHost, path: &str) -> String {
        let address = host.address();
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
        assert!(response.starts_with("HTTP/1.1 200 OK"), "{response}");
        response.split_once("\r\n\r\n").unwrap().1.to_owned()
    }

    fn url(value: &str) -> Url {
        value.parse().unwrap()
    }

    #[test]
    fn only_web_links_leave_the_review_window_for_the_default_browser() {
        let local = url("http://127.0.0.1:4100/");
        for stay in [
            "http://127.0.0.1:4100/",
            "http://127.0.0.1:4100/api/v1/health?x=1#a",
        ] {
            assert_eq!(navigation(&url(stay), &local), Navigation::Stay, "{stay}");
        }
        for web in [
            "https://example.com/docs?a=1&b=2",
            "http://example.com",
            "http://127.0.0.1:4101/",
            "http://localhost:4100/",
            "https://user@example.com/",
        ] {
            assert_eq!(
                navigation(&url(web), &local),
                Navigation::OpenInBrowser,
                "{web}"
            );
        }
        for blocked in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "mailto:someone@example.com",
            "ftp://example.com/",
            "about:blank",
            "tauri://localhost/",
        ] {
            assert_eq!(
                navigation(&url(blocked), &local),
                Navigation::Block,
                "{blocked}"
            );
        }
    }

    #[test]
    fn native_entry_starts_the_built_client_with_difftool_inputs() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let args = [
            OsString::from("--difftool"),
            root.join("Cargo.toml").into_os_string(),
            root.join("tauri.conf.json").into_os_string(),
        ];
        let input = launch_input(&args).unwrap();
        let host = start_host(&development_assets(), input.clone()).unwrap();
        assert!(host.address().ip().is_loopback());
        let page = get(&host, "/");
        assert!(page.contains("<title>Glassbox</title>"));
        let health: serde_json::Value =
            serde_json::from_str(&get(&host, "/api/v1/health")).unwrap();
        assert_eq!(health["status"], "ready");
        let launch: DifftoolInput = serde_json::from_str(&get(&host, "/api/v1/difftool")).unwrap();
        assert_eq!(Some(launch), input);
        tauri::async_runtime::block_on(host.stop()).unwrap();
    }
}
