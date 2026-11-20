//! Shared loopback host for the web and desktop clients.

use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::path::Path;

use axum::extract::{DefaultBodyLimit, Path as RoutePath, Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse, Response};
use axum::{
    Json, Router,
    routing::{get, post},
};
pub use glassbox_model::DifftoolInput;
use glassbox_model::{Appearance, ApplicationSettings, ServiceHealth};
use glassbox_settings::SettingsStore;
use serde::Deserialize;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower_http::services::ServeDir;

mod analysis;
mod discussion;
mod export;
mod review_files;
mod storage;

pub struct LocalHost {
    address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<io::Result<()>>,
}

impl LocalHost {
    pub async fn start(assets: Option<&Path>) -> io::Result<Self> {
        Self::start_with_difftool(assets, None).await
    }

    pub async fn start_with_difftool(
        assets: Option<&Path>,
        difftool: Option<DifftoolInput>,
    ) -> io::Result<Self> {
        if let Some(path) = assets {
            verify_assets(path)?;
        }
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        let (router, analysis) = router(address, assets, difftool);
        let (shutdown, closing) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = closing.await;
                    analysis.shutdown();
                })
                .await
        });
        Ok(Self {
            address,
            shutdown: Some(shutdown),
            task,
        })
    }

    pub fn address(&self) -> SocketAddr {
        self.address
    }

    pub async fn wait(mut self) -> io::Result<()> {
        (&mut self.task).await.map_err(io::Error::other)?
    }

    pub async fn stop(mut self) -> io::Result<()> {
        self.shutdown.take();
        (&mut self.task).await.map_err(io::Error::other)?
    }
}

impl Drop for LocalHost {
    fn drop(&mut self) {
        self.shutdown.take();
    }
}

fn verify_assets(path: &Path) -> io::Result<()> {
    for page in ["index.html", "ux-demo/index.html"] {
        if !path.join(page).is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!(
                    "Missing built frontend file: {}. Run npm run build.",
                    path.join(page).display()
                ),
            ));
        }
    }
    Ok(())
}

#[derive(Clone)]
struct LocalOrigin {
    host: String,
    origin: String,
}

fn router(
    address: SocketAddr,
    assets: Option<&Path>,
    difftool: Option<DifftoolInput>,
) -> (Router, analysis::Analysis) {
    let source_launch = difftool.clone();
    let selected_launch = difftool.clone();
    let media_launch = difftool.clone();
    let discussion_launch = difftool.clone();
    let handoff_launch = difftool.clone();
    let discussion = discussion::Discussion::default();
    let handoff = discussion.clone();
    let delivery = export::Delivery::new(discussion.clone(), difftool.clone());
    let preview_delivery = delivery.clone();
    let analysis = analysis::Analysis::new(discussion.clone(), difftool.clone());
    let analysis_start = analysis.clone();
    let analysis_status = analysis.clone();
    let analysis_cancel = analysis.clone();
    let mut router = Router::new()
        .route(
            "/api/v1/health",
            get(|| async { Json(ServiceHealth::ready()) }),
        )
        .route("/api/v1/settings", get(settings).put(save_appearance))
        .route("/api/v1/feedback/storage", get(storage::usage))
        .route("/api/v1/feedback/storage/cleanup", post(storage::cleanup))
        .route(
            "/api/v1/review/files",
            post(move |Json(source)| review_files::list(source, source_launch)),
        )
        .route(
            "/api/v1/review/file",
            post(move |Json(file)| review_files::selected(file, selected_launch)),
        )
        .route(
            "/api/v1/review/media",
            post(move |Json(media)| review_files::media(media, media_launch)),
        )
        .route(
            "/api/v1/review/discussion",
            post(move |Json(input)| discussion::handle(discussion, input, discussion_launch))
                .layer(DefaultBodyLimit::max(68_000_000)),
        )
        .route(
            "/api/v1/review/handoff",
            post(move |Json(source)| discussion::handoff(handoff, source, handoff_launch)),
        )
        .route(
            "/api/v1/review/export/preview",
            post(move |Json(input)| export::preview(preview_delivery, input)),
        )
        .route(
            "/api/v1/review/export/send",
            post(move |Json(input)| export::send(delivery, input)),
        )
        .route(
            "/api/v1/review/analysis",
            post(move |Json(input)| async move { analysis_start.start(input) }),
        )
        .route(
            "/api/v1/review/analysis/{id}",
            get(move |RoutePath(id)| async move { analysis_status.status(id, false) })
                .delete(move |RoutePath(id)| async move { analysis_cancel.status(id, true) }),
        )
        .route(
            "/api/v1/review/file/action",
            post(move |Json(input)| review_files::file_action(input, None)),
        );
    if let Some(difftool) = difftool {
        router = router.route("/api/v1/difftool", get(move || async { Json(difftool) }));
    }
    if let Some(assets) = assets {
        router = router.fallback_service(ServeDir::new(assets));
    }
    let local = LocalOrigin {
        host: address.to_string(),
        origin: format!("http://{address}"),
    };
    (
        router.layer(from_fn_with_state(local, guard_local_origin)),
        analysis,
    )
}

async fn settings() -> Response {
    match tokio::task::spawn_blocking(|| SettingsStore::for_current_user()?.load()).await {
        Ok(Ok(settings)) => Json(settings).into_response(),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not read Glassbox settings",
        )
            .into_response(),
    }
}

#[derive(Deserialize)]
struct AppearanceUpdate {
    appearance: Appearance,
}

async fn save_appearance(Json(update): Json<AppearanceUpdate>) -> Response {
    let settings = ApplicationSettings {
        appearance: update.appearance,
    };
    match tokio::task::spawn_blocking(move || SettingsStore::for_current_user()?.save(settings))
        .await
    {
        Ok(Ok(())) => Json(settings).into_response(),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not save Glassbox appearance",
        )
            .into_response(),
    }
}

async fn guard_local_origin(
    State(local): State<LocalOrigin>,
    request: Request,
    next: Next,
) -> Response {
    let headers = request.headers();
    let host = headers.get(header::HOST);
    let origin = headers.get(header::ORIGIN);
    let fetch_site = headers.get("sec-fetch-site");
    if !host.is_some_and(|value| value.as_bytes() == local.host.as_bytes())
        || origin.is_some_and(|value| value.as_bytes() != local.origin.as_bytes())
        || (request.uri().path().starts_with("/api/")
            && fetch_site.is_some_and(|value| value.as_bytes() == b"cross-site"))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}
