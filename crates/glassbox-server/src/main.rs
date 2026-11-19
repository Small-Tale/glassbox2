use std::io;
use std::path::PathBuf;

use glassbox_server::{DifftoolInput, LocalHost};

#[tokio::main(flavor = "current_thread")]
async fn main() -> io::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let (assets, remaining) = match args.as_slice() {
        [flag, path, remaining @ ..] if flag == "--assets" => {
            (Some(PathBuf::from(path)), remaining)
        }
        remaining => (
            std::env::var_os("GLASSBOX_WEB_ASSETS").map(PathBuf::from),
            remaining,
        ),
    };
    let difftool = if remaining.is_empty() {
        None
    } else {
        Some(DifftoolInput::from_arguments(remaining)?)
    };
    let host = LocalHost::start_with_difftool(assets.as_deref(), difftool).await?;
    println!("{}", host.address());
    host.wait().await
}
