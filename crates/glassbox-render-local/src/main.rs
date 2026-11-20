mod process;

use std::ffi::OsStr;
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};

const VERSION: u32 = 1;
const MAX_SOURCE: usize = 1024 * 1024;
const MAX_REQUEST: usize = 6 * MAX_SOURCE + 256;
const MAX_REPLY: usize = 4 * 1024 * 1024;
const TOOL_TIMEOUT: Duration = Duration::from_secs(7);

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Format {
    Graphviz,
    Mermaid,
    Plantuml,
}

#[derive(Deserialize)]
struct Request {
    version: u32,
    format: Format,
    source: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Outcome {
    Rendered { svg: String },
    Unavailable,
}

#[derive(Serialize)]
struct Reply {
    version: u32,
    outcome: Outcome,
}

fn main() -> io::Result<()> {
    let bytes = read_bounded(io::stdin().lock(), MAX_REQUEST)?;
    let outcome = serde_json::from_slice::<Request>(&bytes)
        .ok()
        .and_then(|request| render(request).ok())
        .map_or(Outcome::Unavailable, |svg| Outcome::Rendered { svg });
    let mut response = serde_json::to_vec(&Reply {
        version: VERSION,
        outcome,
    })?;
    if response.len() > MAX_REPLY {
        response = serde_json::to_vec(&Reply {
            version: VERSION,
            outcome: Outcome::Unavailable,
        })?;
    }
    use std::io::Write;
    io::stdout().lock().write_all(&response)
}

fn read_bounded(reader: impl Read, max: usize) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(max as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > max {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Size limit exceeded",
        ));
    }
    Ok(bytes)
}

fn configured(name: &str) -> io::Result<PathBuf> {
    let value = std::env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_default();
    if !value.is_absolute() || !value.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("Configure {name} with an absolute file path"),
        ));
    }
    Ok(value)
}

fn render(request: Request) -> io::Result<String> {
    if request.version != VERSION || request.source.len() > MAX_SOURCE {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Unsupported request",
        ));
    }
    let scratch = tempfile::tempdir()?;
    let output = scratch.path().join("render.svg");
    let mut command = tool_command(request.format, &request.source, scratch.path(), &output)?;
    command.current_dir(scratch.path()).stderr(Stdio::null());
    process::run(command, TOOL_TIMEOUT)?;
    let bytes = read_bounded(File::open(output)?, MAX_REPLY)?;
    let svg = String::from_utf8(bytes).map_err(io::Error::other)?;
    if !svg.contains("<svg") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Tool returned no SVG",
        ));
    }
    Ok(svg)
}

fn tool_command(
    format: Format,
    source: &str,
    scratch: &Path,
    output: &Path,
) -> io::Result<Command> {
    let command = match format {
        Format::Graphviz => {
            let input = scratch.join("source.dot");
            fs::write(&input, source)?;
            let mut command = Command::new(configured("GLASSBOX_GRAPHVIZ_EXECUTABLE")?);
            command.args([
                OsStr::new("-Tsvg"),
                OsStr::new("-o"),
                output.as_os_str(),
                input.as_os_str(),
            ]);
            command.stdin(Stdio::null()).stdout(Stdio::null());
            command
        }
        Format::Mermaid => {
            let input = scratch.join("source.mmd");
            let config = scratch.join("mermaid.json");
            fs::write(&input, source)?;
            fs::write(&config, r#"{"securityLevel":"strict"}"#)?;
            let mut command = Command::new(configured("GLASSBOX_MERMAID_EXECUTABLE")?);
            command
                .arg("-i")
                .arg(input)
                .arg("-o")
                .arg(output)
                .arg("-c")
                .arg(config);
            command.stdin(Stdio::null()).stdout(Stdio::null());
            command
        }
        Format::Plantuml => {
            let input = scratch.join("source.puml");
            fs::write(&input, source)?;
            let mut command = Command::new(configured("GLASSBOX_JAVA_EXECUTABLE")?);
            command
                .arg("-DPLANTUML_SECURITY_PROFILE=SANDBOX")
                .arg("-Djava.awt.headless=true")
                .arg("-jar")
                .arg(configured("GLASSBOX_PLANTUML_JAR")?)
                .args(["-tsvg", "-charset", "UTF-8", "-pipe"]);
            command
                .stdin(File::open(input)?)
                .stdout(File::create(output)?);
            command
        }
    };
    Ok(command)
}
