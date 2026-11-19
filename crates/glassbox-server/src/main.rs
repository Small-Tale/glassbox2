use std::io;
use std::path::PathBuf;

use glassbox_server::LocalHost;

#[tokio::main(flavor = "current_thread")]
async fn main() -> io::Result<()> {
    let mut args = std::env::args_os().skip(1);
    let assets = match args.next() {
        None => None,
        Some(flag) if flag == "--assets" => Some(PathBuf::from(args.next().ok_or_else(usage)?)),
        Some(_) => return Err(usage()),
    };
    if args.next().is_some() {
        return Err(usage());
    }
    let host = LocalHost::start(assets.as_deref()).await?;
    println!("{}", host.address());
    host.wait().await
}

fn usage() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "Usage: glassbox-server [--assets <built-web-directory>]",
    )
}
