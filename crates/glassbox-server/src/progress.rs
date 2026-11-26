//! Per-file review progress for the open comparison (HS2-FTEQVQ).
//!
//! A mark records the revision of the content that was reviewed. It counts only while the file still has that
//! revision, so a file that changed after it was marked returns to unreviewed instead of being miscounted.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use glassbox_model::DifftoolInput;
use glassbox_settings::SettingsStore;
use serde::{Deserialize, Serialize};

use crate::discussion::{ApiError, source_identity};
use crate::review_files::{self, ReviewSource, SelectedFile};

#[derive(Deserialize)]
pub(crate) struct ProgressInput {
    source: ReviewSource,
}

#[derive(Deserialize)]
pub(crate) struct MarkInput {
    #[serde(flatten)]
    file: SelectedFile,
    /// The revision the client is showing; a mismatch means the file changed and nothing is stored.
    revision: String,
    reviewed: bool,
}

#[derive(Serialize)]
struct ProgressView {
    files: Vec<FileProgress>,
}

#[derive(Serialize)]
struct FileProgress {
    path: String,
    /// `reviewed` while the marked revision is current, `changed` once the content has moved on.
    state: &'static str,
}

fn failure(error: impl std::fmt::Display) -> ApiError {
    (StatusCode::BAD_REQUEST, error.to_string())
}

fn store_failure(error: impl std::fmt::Display) -> ApiError {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}

async fn blocking<T: Serialize + Send + 'static>(
    work: impl FnOnce() -> Result<T, ApiError> + Send + 'static,
) -> Response {
    match tokio::task::spawn_blocking(work).await {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err((status, message))) => (status, message).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not load the review progress",
        )
            .into_response(),
    }
}

pub(crate) async fn list(input: ProgressInput, difftool: Option<DifftoolInput>) -> Response {
    blocking(move || {
        let comparison =
            review_files::load(input.source.clone(), difftool.clone()).map_err(failure)?;
        let context = comparison.bundle_context(&input.source, difftool.as_ref());
        let identity = source_identity(&input.source, &context, difftool.as_ref())?;
        let marks = SettingsStore::for_current_user()
            .and_then(|store| store.load_reviewed(&identity))
            .map_err(store_failure)?;
        // Only marked files are rechecked, so an unmarked comparison costs nothing here.
        let files = comparison
            .paths()
            .into_iter()
            .enumerate()
            .filter_map(|(index, path)| {
                let reviewed = marks.get(&path)?;
                let state = match comparison.file_revision(index) {
                    Ok(current) if current == *reviewed => "reviewed",
                    _ => "changed",
                };
                Some(FileProgress { path, state })
            })
            .collect();
        Ok(ProgressView { files })
    })
    .await
}

pub(crate) async fn mark(input: MarkInput, difftool: Option<DifftoolInput>) -> Response {
    blocking(move || {
        let MarkInput {
            file,
            revision,
            reviewed,
        } = input;
        let comparison = review_files::load(file.source.clone(), difftool.clone()).map_err(failure)?;
        review_files::validate_selection(&comparison, file.index, &file.path).map_err(failure)?;
        let context = comparison.bundle_context(&file.source, difftool.as_ref());
        let identity = source_identity(&file.source, &context, difftool.as_ref())?;
        let store = SettingsStore::for_current_user().map_err(store_failure)?;
        if reviewed {
            let current = comparison.file_revision(file.index).map_err(failure)?;
            if current != revision {
                return Err((
                    StatusCode::CONFLICT,
                    "The file changed after it was opened. Open it again before marking it reviewed.".into(),
                ));
            }
            store
                .set_reviewed(&identity, &file.path, Some(&current))
                .map_err(store_failure)?;
        } else {
            store
                .set_reviewed(&identity, &file.path, None)
                .map_err(store_failure)?;
        }
        Ok(serde_json::json!({}))
    })
    .await
}
