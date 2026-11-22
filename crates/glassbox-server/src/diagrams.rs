//! Opt-in diagram rendering through a host-approved executable.

use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use glassbox_model::{DifftoolInput, feedback::FeedbackId};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;

use crate::discussion::Discussion;
use crate::review_files::{self, SelectedFile};

const PROTOCOL_VERSION: u32 = 1;
pub(crate) const MAX_SOURCE_BYTES: usize = 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 4 * 1024 * 1024;
const RENDER_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DiagramFormat {
    Graphviz,
    Mermaid,
    Plantuml,
}

impl DiagramFormat {
    pub(crate) fn for_path(path: &Path) -> Option<Self> {
        match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
            "dot" | "gv" => Some(Self::Graphviz),
            "mmd" | "mermaid" => Some(Self::Mermaid),
            "puml" | "plantuml" => Some(Self::Plantuml),
            _ => None,
        }
    }
}

#[derive(Clone)]
pub(crate) struct Renderer(PathBuf);

pub(crate) struct DiagramSources {
    pub(crate) before: Option<Vec<u8>>,
    pub(crate) after: Option<Vec<u8>>,
}

#[derive(Serialize)]
struct Request<'a> {
    version: u32,
    format: DiagramFormat,
    source: &'a str,
}

#[derive(Deserialize)]
struct Reply {
    version: u32,
    outcome: Outcome,
}

#[derive(Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Outcome {
    Rendered { svg: String },
    Unavailable,
}

impl Renderer {
    pub(crate) fn from_environment() -> Option<Self> {
        let path = PathBuf::from(std::env::var_os("GLASSBOX_CONTENT_RENDERER")?);
        path.is_absolute().then_some(Self(path))
    }

    pub(crate) async fn render(&self, format: DiagramFormat, source: Vec<u8>) -> Option<String> {
        if source.len() > MAX_SOURCE_BYTES {
            return None;
        }
        let source = std::str::from_utf8(&source).ok()?;
        let request = serde_json::to_vec(&Request {
            version: PROTOCOL_VERSION,
            format,
            source,
        })
        .ok()?;
        let renderer = self.clone();
        // The adapter owns its child tree and needs time to reap it when the client leaves.
        let reply = tokio::spawn(async move {
            tokio::time::timeout(RENDER_TIMEOUT, renderer.exchange(&request)).await
        })
        .await
        .ok()?
        .ok()?
        .ok()?;
        match (reply.version, reply.outcome) {
            (PROTOCOL_VERSION, Outcome::Rendered { svg }) if svg.contains("<svg") => Some(svg),
            _ => None,
        }
    }

    async fn exchange(&self, request: &[u8]) -> io::Result<Reply> {
        let mut child = Command::new(&self.0)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()?;
        let mut stdin = child.stdin.take().expect("piped renderer stdin");
        let mut stdout = child
            .stdout
            .take()
            .expect("piped renderer stdout")
            .take(MAX_RESPONSE_BYTES as u64 + 1);
        let mut output = Vec::new();
        tokio::try_join!(
            async move {
                stdin.write_all(request).await?;
                stdin.shutdown().await
            },
            stdout.read_to_end(&mut output),
        )?;
        if output.len() > MAX_RESPONSE_BYTES {
            return Err(io::Error::other(
                "The renderer returned an oversized response",
            ));
        }
        if !child.wait().await?.success() {
            return Err(io::Error::other("The renderer exited unsuccessfully"));
        }
        serde_json::from_slice(&output).map_err(io::Error::other)
    }
}

#[derive(Serialize)]
struct RenderedComparison {
    before: Option<String>,
    after: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ComparisonInput {
    #[serde(flatten)]
    selection: SelectedFile,
    revision: String,
}

#[derive(Deserialize)]
pub(crate) struct ArtifactInput {
    selection: crate::discussion::DiscussionSelection,
    thread: FeedbackId,
    attachment: FeedbackId,
}

#[derive(Serialize)]
struct ArtifactPreview {
    source: String,
    svg: Option<String>,
}

pub(crate) async fn artifact(
    renderer: Option<Renderer>,
    discussion: Discussion,
    input: ArtifactInput,
) -> Response {
    let result = tokio::task::spawn_blocking(move || {
        discussion.diagram_attachment(&input.selection, input.thread, input.attachment)
    })
    .await;
    let (format, bytes) = match result {
        Ok(Ok(Some(artifact))) => artifact,
        Ok(Ok(None)) => return StatusCode::NOT_FOUND.into_response(),
        Ok(Err((status, message))) => return (status, message).into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let Ok(source) = String::from_utf8(bytes) else {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            "The diagram is not UTF-8.",
        )
            .into_response();
    };
    let svg = match renderer {
        Some(renderer) => renderer.render(format, source.as_bytes().to_vec()).await,
        None => None,
    };
    Json(ArtifactPreview { source, svg }).into_response()
}

pub(crate) async fn comparison(
    renderer: Option<Renderer>,
    input: ComparisonInput,
    difftool: Option<DifftoolInput>,
) -> Response {
    let file = input.selection;
    let (Some(renderer), Some(format)) = (renderer, DiagramFormat::for_path(Path::new(&file.path)))
    else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let sources = tokio::task::spawn_blocking(move || {
        let comparison = review_files::load(file.source, difftool)?;
        review_files::validate_selection(&comparison, file.index, &file.path)?;
        let sources = comparison.diagram_sources(file.index)?;
        let hunks = glassbox_comparison::compare_text_bytes(
            sources.before.as_deref().unwrap_or_default(),
            sources.after.as_deref().unwrap_or_default(),
        )?;
        Ok::<_, io::Error>((sources, review_files::text_revision(&hunks)?))
    })
    .await;
    let sources = match sources {
        Ok(Ok((sides, revision))) if revision == input.revision => sides,
        Ok(Ok(_)) => {
            return (
                StatusCode::CONFLICT,
                "The diagram source has changed. Reopen the file.",
            )
                .into_response();
        }
        Ok(Err(error)) => return (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    let render = |source| async {
        match source {
            Some(source) => renderer.render(format, source).await.map(Some).ok_or(()),
            None => Ok(None),
        }
    };
    match tokio::try_join!(render(sources.before), render(sources.after)) {
        Ok((before, after)) => Json(RenderedComparison { before, after }).into_response(),
        Err(()) => (
            StatusCode::UNPROCESSABLE_ENTITY,
            "The renderer could not preview this comparison.",
        )
            .into_response(),
    }
}
