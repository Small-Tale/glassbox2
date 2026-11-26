use std::env;
use std::ffi::OsString;
use std::io;
use std::process::{Command, ExitStatus};

mod register;

const TOOL_COMMAND: &str = r#"if [ -n "$GLASSBOX_DIFFTOOL_SELF" ]; then "$GLASSBOX_DIFFTOOL_SELF" --git-difftool "$LOCAL" "$REMOTE"; else glassbox-cli --git-difftool "$LOCAL" "$REMOTE"; fi"#;

fn main() -> std::process::ExitCode {
    let args: Vec<OsString> = env::args_os().skip(1).collect();
    // HS2-HVP8Q1: registering or unregistering the default Git difftool never reaches `git difftool`.
    if let Some(request) = register::parse(&args) {
        return match request.and_then(|request| register::execute(&request)) {
            Ok(report) => {
                for line in report {
                    println!("{line}");
                }
                std::process::ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("glassbox-cli: {error}");
                std::process::ExitCode::FAILURE
            }
        };
    }
    match run(args) {
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

    reject_tool_overrides(&args)?;
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

/// Git difftool long options that choose a tool other than the one Glassbox selects, or that
/// stop it from launching one (HS2-40BYH7). Git accepts any unambiguous abbreviation of a long
/// option, so a name that is a prefix of one of these is rejected too.
const TOOL_LONG_OPTIONS: [&str; 5] = ["tool", "tool-help", "extcmd", "gui", "no-gui"];
/// Short options that choose a tool (`-t`, `-x`, `-g`).
const TOOL_SHORT_OPTIONS: &[u8] = b"txg";
/// Short options whose attached text is a value, not further options (`-Ofile`, `-U5`).
const VALUE_SHORT_OPTIONS: &[u8] = b"UOSGMCBlI";

/// Refuse arguments that would replace the Glassbox tool. Everything after `--` is a pathspec.
fn reject_tool_overrides(args: &[OsString]) -> io::Result<()> {
    for arg in args {
        let bytes = arg.as_encoded_bytes();
        if bytes == b"--" {
            break;
        }
        let overrides = if let Some(name) = bytes.strip_prefix(b"--") {
            let name = name.split(|byte| *byte == b'=').next().unwrap_or_default();
            !name.is_empty()
                && TOOL_LONG_OPTIONS
                    .iter()
                    .any(|option| option.as_bytes().starts_with(name))
        } else if let Some(cluster) = bytes.strip_prefix(b"-") {
            cluster
                .iter()
                .take_while(|byte| !VALUE_SHORT_OPTIONS.contains(byte))
                .any(|byte| TOOL_SHORT_OPTIONS.contains(byte))
        } else {
            false
        };
        if overrides {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "{} would replace the Glassbox tool; -t/--tool, -x/--extcmd, -g/--gui and \
                     --tool-help are not accepted",
                    arg.to_string_lossy()
                ),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(args: &[&str]) -> io::Result<()> {
        reject_tool_overrides(&args.iter().map(OsString::from).collect::<Vec<_>>())
    }

    #[test]
    fn options_that_choose_another_tool_are_rejected_in_every_spelling() {
        for args in [
            &["--tool=vimdiff"][..],
            &["--tool", "vimdiff"],
            &["--to=vimdiff"],
            &["--t=vimdiff"],
            &["-t", "vimdiff"],
            &["-tvimdiff"],
            &["-dt", "vimdiff"],
            &["--extcmd=true"],
            &["--ext", "true"],
            &["-x", "true"],
            &["-xtrue"],
            &["--gui"],
            &["-g"],
            &["--no-gui"],
            &["--tool-help"],
            &["--dir-diff", "-y", "--tool=other"],
            &["HEAD~1..HEAD", "--extcmd=sh"],
        ] {
            let error = check(args).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidInput, "{args:?}");
            assert!(error.to_string().contains("replace the Glassbox tool"));
        }
    }

    #[test]
    fn ordinary_difftool_and_diff_arguments_pass_through() {
        for args in [
            &[][..],
            &["--no-prompt", "HEAD", "--", "src/"],
            &["--dir-diff", "main", "HEAD"],
            &["-d", "-y", "main...HEAD"],
            &["--no-prompt", "--no-symlinks", "--trust-exit-code"],
            &[
                "--diff-filter=AM",
                "--stat",
                "-U5",
                "-Ox.txt",
                "-Sfoo",
                "-Gtext",
            ],
            &["--no-p", "HEAD"],
            &["--name-only", "--cached"],
            &["-"],
            &["spaced name.txt"],
        ] {
            check(args).unwrap_or_else(|error| panic!("{args:?}: {error}"));
        }
    }

    #[test]
    fn pathspecs_after_the_separator_are_never_options() {
        for args in [
            &["--", "--tool=vimdiff"][..],
            &["HEAD", "--", "-t", "-x", "--gui", "--extcmd=sh"],
            &["--dir-diff", "--", "-tfile"],
        ] {
            check(args).unwrap_or_else(|error| panic!("{args:?}: {error}"));
        }
        assert!(check(&["--tool=vimdiff", "--", "src"]).is_err());
    }
}
