use std::io;
use std::path::PathBuf;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use glassbox_feedback::{BundleStore, CleanupScope};
use serde::{Deserialize, Serialize};

pub(crate) fn feedback_store() -> io::Result<BundleStore> {
    match std::env::var_os("GLASSBOX_FEEDBACK_DIRECTORY") {
        Some(path) => Ok(BundleStore::in_directory(PathBuf::from(path))),
        None => BundleStore::for_current_user(),
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Scope {
    All,
    Project { project: PathBuf },
}

#[derive(Deserialize)]
pub(crate) struct Cleanup {
    scope: Scope,
    confirmed: bool,
}

pub(crate) async fn usage() -> Response {
    operation(|| feedback_store()?.usage()).await
}

pub(crate) async fn cleanup(Json(input): Json<Cleanup>) -> Response {
    if !input.confirmed {
        return (
            StatusCode::BAD_REQUEST,
            "Confirm feedback cleanup before continuing.",
        )
            .into_response();
    }
    let scope = match input.scope {
        Scope::All => CleanupScope::All,
        Scope::Project { project } if project.is_absolute() => CleanupScope::Project(project),
        Scope::Project { .. } => {
            return (StatusCode::BAD_REQUEST, "Choose an absolute project path.").into_response();
        }
    };
    operation(move || feedback_store()?.cleanup(scope)).await
}

async fn operation<T: Serialize + Send + 'static>(
    run: impl FnOnce() -> io::Result<T> + Send + 'static,
) -> Response {
    match tokio::task::spawn_blocking(run).await {
        Ok(Ok(value)) => Json(value).into_response(),
        Ok(Err(error)) => (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not manage feedback storage.",
        )
            .into_response(),
    }
}
