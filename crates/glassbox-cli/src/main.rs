use std::env;
use std::ffi::OsString;
use std::io;
use std::process::{Command, ExitStatus};

const TOOL_COMMAND: &str = r#"if [ -n "$GLASSBOX_DIFFTOOL_SELF" ]; then "$GLASSBOX_DIFFTOOL_SELF" --git-difftool "$LOCAL" "$REMOTE"; else glassbox-cli --git-difftool "$LOCAL" "$REMOTE"; fi"#;

fn main() -> std::process::ExitCode {
    match run(env::args_os().skip(1).collect()) {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!("glassbox-cli: {error}");
            std::process::ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<OsString>) -> io::Result<ExitStatus> {
    if let [mode, before, after] = args.as_slice() {
        if mode == "--git-difftool" {
            let client = env::var_os("GLASSBOX_DIFFTOOL_CLIENT")
                .unwrap_or_else(|| OsString::from("glassbox-desktop"));
            return Command::new(&client)
                .args([OsString::from("--difftool"), before.clone(), after.clone()])
                .status()
                .map_err(|error| {
                    io::Error::new(
                        error.kind(),
                        format!("launch {}: {error}", client.to_string_lossy()),
                    )
                });
        }
    }
    if args.first().is_some_and(|arg| arg == "--git-difftool") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Git must pass two comparison paths",
        ));
    }

    let executable = env::current_exe()?;
    #[cfg(windows)]
    let executable = executable.to_string_lossy().replace('\\', "/");
    Command::new("git")
        .env("GLASSBOX_DIFFTOOL_SELF", executable)
        .args(["-c", &format!("difftool.glassbox.cmd={TOOL_COMMAND}")])
        .args([
            "difftool",
            "--tool=glassbox",
            "--no-symlinks",
            "--trust-exit-code",
        ])
        .args(args)
        .status()
}
