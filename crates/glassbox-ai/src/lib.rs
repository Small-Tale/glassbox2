//! Versioned AI provider manifests and a one-request subprocess transport.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

pub const PROTOCOL_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug)]
pub enum ProviderError {
    Io(io::Error),
    Json(serde_json::Error),
    Manifest(PathBuf),
    DuplicateId(String),
    UnsupportedVersion(u32),
    MessageTooLarge,
    ProcessFailed,
    Timeout,
    Backend(Failure),
}

impl From<io::Error> for ProviderError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for ProviderError {
    fn from(error: serde_json::Error) -> Self {
        Self::Json(error)
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub executable: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "method", rename_all = "snake_case")]
pub enum Request {
    ListModels,
    Generate {
        model: String,
        system: String,
        prompt: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Invocation {
    pub version: u32,
    #[serde(default)]
    pub settings: BTreeMap<String, serde_json::Value>,
    pub request: Request,
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum Outcome {
    Models { models: Vec<String> },
    Generated { text: String },
    Error { code: Failure },
}

#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Failure {
    Unavailable,
    AuthenticationRequired,
    UnknownModel,
    RequestRejected,
    BackendFailure,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Reply {
    pub version: u32,
    pub outcome: Outcome,
}

/// Load provider declarations from a host-selected directory. Discovery never starts a provider.
pub fn discover(directory: &Path) -> Result<BTreeMap<String, Manifest>, ProviderError> {
    use std::io::Read;

    let mut registry = BTreeMap::new();
    let mut paths = std::fs::read_dir(directory)?.collect::<io::Result<Vec<_>>>()?;
    paths.sort_by_key(|entry| entry.file_name());
    for entry in paths {
        let path = entry.path();
        if path.extension().is_none_or(|extension| extension != "json")
            || !entry.file_type()?.is_file()
        {
            continue;
        }
        let mut bytes = Vec::new();
        std::fs::File::open(&path)?
            .take(MAX_MANIFEST_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_MANIFEST_BYTES {
            return Err(ProviderError::Manifest(path));
        }
        let manifest: Manifest = serde_json::from_slice(&bytes)?;
        if manifest.version != PROTOCOL_VERSION {
            return Err(ProviderError::UnsupportedVersion(manifest.version));
        }
        if manifest.id.is_empty()
            || manifest.name.trim().is_empty()
            || !manifest
                .id
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            || !manifest.executable.is_absolute()
        {
            return Err(ProviderError::Manifest(path));
        }
        let id = manifest.id.clone();
        if registry.insert(id.clone(), manifest).is_some() {
            return Err(ProviderError::DuplicateId(id));
        }
    }
    Ok(registry)
}

/// Invoke an executable explicitly approved by the host. Dropping the future kills the child.
pub async fn invoke(
    approved_executable: &Path,
    request: Request,
    settings: BTreeMap<String, serde_json::Value>,
    timeout: Duration,
) -> Result<Outcome, ProviderError> {
    if !approved_executable.is_absolute() {
        return Err(ProviderError::Manifest(approved_executable.into()));
    }
    let invocation = Invocation {
        version: PROTOCOL_VERSION,
        settings,
        request,
    };
    let mut bytes = serde_json::to_vec(&invocation)?;
    bytes.push(b'\n');
    if bytes.len() > MAX_MESSAGE_BYTES {
        return Err(ProviderError::MessageTooLarge);
    }
    tokio::time::timeout(
        timeout,
        exchange(approved_executable, &bytes, &invocation.request),
    )
    .await
    .map_err(|_| ProviderError::Timeout)?
}

async fn exchange(
    executable: &Path,
    bytes: &[u8],
    request: &Request,
) -> Result<Outcome, ProviderError> {
    let mut child = Command::new(executable)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdin = child.stdin.take().expect("piped provider stdin");
    let mut stdout = child
        .stdout
        .take()
        .expect("piped provider stdout")
        .take(MAX_MESSAGE_BYTES as u64 + 1);
    let mut output = Vec::new();
    tokio::try_join!(
        async move {
            stdin.write_all(bytes).await?;
            stdin.shutdown().await
        },
        stdout.read_to_end(&mut output),
    )?;
    if output.len() > MAX_MESSAGE_BYTES {
        return Err(ProviderError::MessageTooLarge);
    }
    if !child.wait().await?.success() {
        return Err(ProviderError::ProcessFailed);
    }
    let reply: Reply = serde_json::from_slice(&output)?;
    if reply.version != PROTOCOL_VERSION {
        return Err(ProviderError::UnsupportedVersion(reply.version));
    }
    match (request, reply.outcome) {
        (Request::ListModels, outcome @ Outcome::Models { .. })
        | (Request::Generate { .. }, outcome @ Outcome::Generated { .. }) => Ok(outcome),
        (_, Outcome::Error { code }) => Err(ProviderError::Backend(code)),
        _ => Err(ProviderError::ProcessFailed),
    }
}
