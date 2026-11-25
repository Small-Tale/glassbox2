use std::ffi::OsString;
use std::io;
use std::path::PathBuf;

use glassbox_server::{DifftoolInput, LocalHost, browser};

/// The terminal launch options (HS2-M7CXQV). Everything after the options is the Git difftool
/// input, so these options stay compatible with `--difftool <before> <after>`.
#[derive(Debug, Default, PartialEq, Eq)]
struct Launch {
    assets: Option<PathBuf>,
    open_browser: bool,
    difftool: Vec<OsString>,
}

fn parse(args: &[OsString]) -> io::Result<Launch> {
    let mut launch = Launch::default();
    let mut rest = args;
    loop {
        match rest {
            [flag, path, tail @ ..] if flag == "--assets" => {
                launch.assets = Some(PathBuf::from(path));
                rest = tail;
            }
            [flag, ..] if flag == "--assets" => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Expected --assets <directory>",
                ));
            }
            [flag, tail @ ..] if flag == "--open" => {
                launch.open_browser = true;
                rest = tail;
            }
            _ => break,
        }
    }
    launch.difftool = rest.to_vec();
    Ok(launch)
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> io::Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    let launch = parse(&args)?;
    let assets = launch
        .assets
        .or_else(|| std::env::var_os("GLASSBOX_WEB_ASSETS").map(PathBuf::from));
    let difftool = if launch.difftool.is_empty() {
        None
    } else {
        Some(DifftoolInput::from_arguments(&launch.difftool)?)
    };
    let host = LocalHost::start_with_difftool(assets.as_deref(), difftool).await?;
    println!("{}", host.address());
    if launch.open_browser {
        // The host is ready and reachable, so a browser that cannot be opened is not fatal.
        let url = format!("http://{}/", host.address());
        if let Err(error) = browser::open_in_browser(&url) {
            eprintln!("Could not open {url} in the default browser: {error}");
        }
    }
    host.wait().await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(args: &[&str]) -> io::Result<Launch> {
        parse(&args.iter().map(OsString::from).collect::<Vec<_>>())
    }

    #[test]
    fn headless_is_the_default_and_options_precede_the_difftool_input() {
        assert_eq!(parsed(&[]).unwrap(), Launch::default());
        let launch = parsed(&["--open", "--assets", "web", "--difftool", "a", "b"]).unwrap();
        assert!(launch.open_browser);
        assert_eq!(launch.assets, Some(PathBuf::from("web")));
        assert_eq!(
            launch.difftool,
            ["--difftool", "a", "b"].map(OsString::from)
        );
        let same = parsed(&["--assets", "web", "--open"]).unwrap();
        assert!(same.open_browser && same.difftool.is_empty());
        let headless = parsed(&["--difftool", "a", "b"]).unwrap();
        assert!(!headless.open_browser);
        assert_eq!(headless.difftool.len(), 3);
    }

    #[test]
    fn an_option_after_the_difftool_input_is_not_taken_as_an_option() {
        let launch = parsed(&["--difftool", "a", "--open"]).unwrap();
        assert!(!launch.open_browser);
        assert_eq!(launch.difftool.len(), 3);
        assert!(parsed(&["--assets"]).is_err());
    }
}
