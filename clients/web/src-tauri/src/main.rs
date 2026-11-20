#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsString;
use std::io;
use std::path::{Path, PathBuf};

use glassbox_server::{DifftoolInput, LocalHost};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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
            let origin = url.origin();
            app.manage(host);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .on_navigation(move |target| target.origin() == origin)
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
