use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::time::Duration;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use glassbox_ai::{Manifest, Outcome, Request, discover, invoke};
use glassbox_settings::{AnalysisPreferences, SettingsStore};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) const PROVIDER_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Serialize)]
struct PreferencesView {
    preferences: AnalysisPreferences,
    providers: Vec<Choice>,
}

#[derive(Serialize)]
struct Choice {
    id: String,
    name: String,
    executable: PathBuf,
}

#[derive(Deserialize)]
pub(crate) struct ModelRequest {
    provider: String,
}

pub(crate) async fn get() -> Response {
    match tokio::task::spawn_blocking(view).await {
        Ok(Ok(view)) => Json(view).into_response(),
        Ok(Err(error)) => storage_error(error),
        Err(_) => storage_error("Could not read analysis preferences"),
    }
}

pub(crate) async fn save(Json(input): Json<AnalysisPreferences>) -> Response {
    match tokio::task::spawn_blocking(move || save_preferences(input)).await {
        Ok(Ok(())) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(error)) => error.into_response(),
        Err(_) => storage_error("Could not save analysis preferences"),
    }
}

pub(crate) async fn models(Json(input): Json<ModelRequest>) -> Response {
    let result = registry().and_then(|mut providers| {
        providers
            .remove(&input.provider)
            .ok_or_else(|| "The provider has not been approved by the host.".into())
    });
    let provider = match result {
        Ok(provider) => provider,
        Err(error) => return (StatusCode::BAD_REQUEST, error).into_response(),
    };
    match async {
        let settings = adapter_settings(&provider.id)?;
        list_models(&provider, settings).await
    }
    .await
    {
        Ok(models) => Json(models).into_response(),
        Err(error) => (StatusCode::BAD_GATEWAY, error).into_response(),
    }
}

fn storage_error(error: impl std::fmt::Display) -> Response {
    (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()).into_response()
}

fn view() -> Result<PreferencesView, String> {
    let preferences = active()?;
    let providers = registry()?
        .into_values()
        .map(|provider| Choice {
            id: provider.id,
            name: provider.name,
            executable: provider.executable,
        })
        .collect();
    Ok(PreferencesView {
        preferences,
        providers,
    })
}

fn save_preferences(preferences: AnalysisPreferences) -> Result<(), (StatusCode, String)> {
    let invalid = |message: &str| (StatusCode::BAD_REQUEST, message.to_owned());
    if let Some(id) = &preferences.provider {
        registry()
            .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?
            .get(id)
            .ok_or_else(|| invalid("The provider has not been approved by the host."))?;
    }
    if preferences.model.as_ref().is_some_and(|model| {
        preferences.provider.is_none()
            || model.trim().is_empty()
            || model.len() > 256
            || model.contains(char::is_control)
    }) {
        return Err(invalid(
            "Choose an available model for the selected provider.",
        ));
    }
    SettingsStore::for_current_user()
        .and_then(|store| store.save_analysis(preferences))
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))
}

pub(super) fn active() -> Result<AnalysisPreferences, String> {
    let saved = SettingsStore::for_current_user()
        .and_then(|store| store.load_analysis())
        .map_err(|error| error.to_string())?;
    Ok(saved.unwrap_or_else(|| AnalysisPreferences {
        provider: launch_provider(),
        model: std::env::var("GLASSBOX_AI_MODEL").ok(),
        ..AnalysisPreferences::default()
    }))
}

pub(super) fn model_revision(id: &str, model: Option<&str>) -> Option<String> {
    if launch_provider().as_deref() != Some(id)
        || std::env::var("GLASSBOX_AI_MODEL").ok().as_deref() != model
    {
        return None;
    }
    std::env::var("GLASSBOX_AI_MODEL_REVISION")
        .ok()
        .filter(|revision| !revision.trim().is_empty())
}

fn launch_provider() -> Option<String> {
    std::env::var("GLASSBOX_AI_PROVIDER")
        .ok()
        .filter(|id| !id.trim().is_empty())
}

pub(super) fn registry() -> Result<BTreeMap<String, Manifest>, String> {
    let Some(directory) =
        std::env::var_os("GLASSBOX_AI_PROVIDER_DIRECTORY").filter(|path| !path.is_empty())
    else {
        return Ok(BTreeMap::new());
    };
    let extra = std::env::var("GLASSBOX_AI_TRUSTED_PROVIDERS").unwrap_or_default();
    let approved: BTreeSet<String> = extra
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .chain(launch_provider())
        .collect();
    if approved.is_empty() {
        return Ok(BTreeMap::new());
    }
    let mut providers = discover(&PathBuf::from(directory))
        .map_err(|error| format!("Could not read the provider registry: {error:?}"))?;
    providers.retain(|id, _| approved.contains(id));
    Ok(providers)
}

pub(super) fn adapter_settings(id: &str) -> Result<BTreeMap<String, Value>, String> {
    if launch_provider().as_deref() != Some(id) {
        return Ok(BTreeMap::new());
    }
    std::env::var("GLASSBOX_AI_PROVIDER_SETTINGS")
        .ok()
        .map(|value| serde_json::from_str(&value))
        .transpose()
        .map(|value| value.unwrap_or_default())
        .map_err(|_| "The AI provider settings must be a JSON object.".into())
}

pub(super) async fn list_models(
    manifest: &Manifest,
    settings: BTreeMap<String, Value>,
) -> Result<Vec<String>, String> {
    let outcome = invoke(
        &manifest.executable,
        Request::ListModels,
        settings,
        PROVIDER_TIMEOUT,
    )
    .await
    .map_err(|error| format!("The AI provider could not list models: {error:?}"))?;
    match outcome {
        Outcome::Models { models } => Ok(models),
        _ => Err("The AI provider returned an unexpected reply.".into()),
    }
}
