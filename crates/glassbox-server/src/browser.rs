//! Opening an address in the system default browser (HS2-E6C9C9, HS2-M7CXQV).

use std::ffi::OsStr;
use std::io;
use std::process::{Command, Stdio};

#[cfg(target_os = "macos")]
const BROWSER_OPENER: &str = "open";
#[cfg(all(unix, not(target_os = "macos")))]
const BROWSER_OPENER: &str = "xdg-open";
#[cfg(windows)]
const BROWSER_OPENER: &str = "rundll32";

/// Hand `url` to the system default browser without waiting for it.
///
/// The address is a single argument to the launcher and never passes through a shell.
pub fn open_in_browser(url: &str) -> io::Result<()> {
    open_with(BROWSER_OPENER, url)
}

/// Like [`open_in_browser`] with an explicit launcher program.
pub fn open_with(opener: impl AsRef<OsStr>, url: &str) -> io::Result<()> {
    let mut command = Command::new(opener);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command
            .arg("url.dll,FileProtocolHandler")
            .creation_flags(0x0800_0000);
    }
    let mut child = command
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    // Reap the launcher without blocking the caller.
    std::thread::spawn(move || child.wait());
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, Instant};

    #[test]
    fn the_launcher_gets_the_exact_url_as_one_argument_and_failures_are_reported() {
        let directory = tempfile::tempdir().unwrap();
        let log = directory.path().join("log");
        let script = directory.path().join("opener");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\nprintf '%s|%s' \"$#\" \"$1\" > '{}'\n",
                log.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let link = "https://example.com/a b?x=1&y=$(touch pwned)";
        open_with(&script, link).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let logged = loop {
            if let Ok(text) = std::fs::read_to_string(&log) {
                break text;
            }
            assert!(Instant::now() < deadline, "the opener never ran");
            std::thread::sleep(Duration::from_millis(20));
        };
        assert_eq!(logged, format!("1|{link}"));
        assert!(!directory.path().join("pwned").exists());
        assert!(open_with(directory.path().join("missing"), link).is_err());
    }
}
