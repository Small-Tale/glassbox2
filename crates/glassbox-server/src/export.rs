use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use glassbox_feedback::{
    ExportReceipt, ExportRequest, HotSheetClient, PreparedExport, RecentTicket,
};
use glassbox_model::DifftoolInput;
use serde::{Deserialize, Serialize};

use crate::discussion::{Discussion, Preview};
use crate::review_files::{self, ReviewSource};

#[derive(Clone)]
pub(crate) struct Delivery {
    discussion: Discussion,
    difftool: Option<DifftoolInput>,
    attempts: Arc<Mutex<BTreeMap<String, Attempt>>>,
}

struct Attempt {
    target: Vec<u8>,
    phase: DeliveryPhase,
}

enum DeliveryPhase {
    Prepared(Box<PreparedExport>),
    Sent(ExportReceipt),
}

#[derive(Deserialize)]
pub(crate) struct PreviewInput {
    source: ReviewSource,
    destination: Option<PathBuf>,
    #[serde(default)]
    recent: bool,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct SendInput {
    id: String,
    source: ReviewSource,
    destination: Option<PathBuf>,
    request: ExportRequest,
}

#[derive(Serialize)]
struct Destination {
    name: String,
    path: PathBuf,
}

#[derive(Serialize)]
struct DeliveryPreview {
    destination: Option<Destination>,
    recent: Vec<RecentTicket>,
    feedback: Preview,
    message: Option<String>,
}

type ApiError = (StatusCode, String);

impl Delivery {
    pub(crate) fn new(discussion: Discussion, difftool: Option<DifftoolInput>) -> Self {
        Self {
            discussion,
            difftool,
            attempts: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    fn client(
        &self,
        source: &ReviewSource,
        explicit: Option<&PathBuf>,
    ) -> Result<HotSheetClient, ApiError> {
        if let Some(explicit) = explicit {
            return HotSheetClient::for_destination(explicit).map_err(bad_request);
        }
        let comparison =
            review_files::load(source.clone(), self.difftool.clone()).map_err(bad_request)?;
        let project = comparison
            .bundle_context(source, self.difftool.as_ref())
            .project;
        let path = project
            .ok_or_else(|| bad_request("Choose a Hot Sheet project to receive this review."))?;
        HotSheetClient::for_project(&path).map_err(bad_request)
    }

    fn preview(&self, input: PreviewInput) -> Result<DeliveryPreview, ApiError> {
        let feedback = self.discussion.preview(&input.source)?;
        let client = match self.client(&input.source, input.destination.as_ref()) {
            Ok(client) => client,
            Err((_, message)) => {
                return Ok(DeliveryPreview {
                    feedback,
                    destination: None,
                    recent: Vec::new(),
                    message: Some(message),
                });
            }
        };
        let path = client.store_path().to_path_buf();
        let name = path
            .file_name()
            .unwrap_or(path.as_os_str())
            .to_string_lossy()
            .into_owned();
        let (recent, message) = if input.recent {
            match client.recent_tickets() {
                Ok(tickets) => (tickets, None),
                Err(error) => (Vec::new(), Some(error.to_string())),
            }
        } else {
            (Vec::new(), None)
        };
        Ok(DeliveryPreview {
            feedback,
            destination: Some(Destination { name, path }),
            recent,
            message,
        })
    }

    fn send(&self, input: SendInput) -> Result<ExportReceipt, ApiError> {
        if input.id.len() != 36
            || !input
                .id
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
        {
            return Err(bad_request("Invalid delivery identifier."));
        }
        let target = serde_json::to_vec(&input).map_err(bad_request)?;
        let mut attempts = self.attempts.lock().map_err(storage_error)?;
        let attempt = match attempts.entry(input.id) {
            std::collections::btree_map::Entry::Occupied(entry) => entry.into_mut(),
            std::collections::btree_map::Entry::Vacant(entry) => {
                let client = self.client(&input.source, input.destination.as_ref())?;
                let prepared = self.discussion.prepare_export(
                    &input.source,
                    self.difftool.clone(),
                    client,
                    input.request,
                )?;
                entry.insert(Attempt {
                    target: target.clone(),
                    phase: DeliveryPhase::Prepared(Box::new(prepared)),
                })
            }
        };
        if attempt.target != target {
            return Err((
                StatusCode::CONFLICT,
                "Start a new delivery after changing its destination or summary.".into(),
            ));
        }
        let receipt = match &mut attempt.phase {
            DeliveryPhase::Prepared(prepared) => prepared.send().map_err(bad_request)?,
            DeliveryPhase::Sent(receipt) => return Ok(receipt.clone()),
        };
        attempt.phase = DeliveryPhase::Sent(receipt.clone());
        Ok(receipt)
    }
}

fn bad_request(error: impl std::fmt::Display) -> ApiError {
    (StatusCode::BAD_REQUEST, error.to_string())
}

fn storage_error(error: impl std::fmt::Display) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

async fn blocking<T: Serialize + Send + 'static>(
    run: impl FnOnce() -> Result<T, ApiError> + Send + 'static,
) -> Response {
    match tokio::task::spawn_blocking(run).await {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not process the Hot Sheet delivery",
        )
            .into_response(),
    }
}

pub(crate) async fn preview(delivery: Delivery, input: PreviewInput) -> Response {
    blocking(move || delivery.preview(input)).await
}

pub(crate) async fn send(delivery: Delivery, input: SendInput) -> Response {
    blocking(move || delivery.send(input)).await
}
