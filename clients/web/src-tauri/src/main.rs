#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

use glassbox_server::{DifftoolInput, LocalHost};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn main() -> tauri::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let difftool = (!args.is_empty())
        .then(|| DifftoolInput::from_arguments(&args))
        .transpose()?;
    tauri::Builder::default()
        .setup(move |app| {
            let assets = if cfg!(debug_assertions) {
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist")
            } else {
                app.path().resource_dir()?.join("web")
            };
            let host = tauri::async_runtime::block_on(LocalHost::start_with_difftool(
                Some(&assets),
                difftool,
            ))?;
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
