//! Shared loopback host for the web and desktop clients.

use std::io;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::path::Path;

use axum::extract::{Request, State};
use axum::http::{StatusCode, header};
use axum::middleware::{Next, from_fn_with_state};
use axum::response::{IntoResponse, Response};
use axum::{Json, Router, routing::get};
use glassbox_model::ServiceHealth;
use glassbox_settings::SettingsStore;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tower_http::services::ServeDir;

pub struct LocalHost {
    address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<io::Result<()>>,
}

impl LocalHost {
    pub async fn start(assets: Option<&Path>) -> io::Result<Self> {
        if let Some(path) = assets {
            verify_assets(path)?;
        }
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        let router = router(address, assets);
        let (shutdown, closing) = oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = closing.await;
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

fn router(address: SocketAddr, assets: Option<&Path>) -> Router {
    let mut router = Router::new()
        .route(
            "/api/v1/health",
            get(|| async { Json(ServiceHealth::ready()) }),
        )
        .route("/api/v1/settings", get(settings));
    if let Some(assets) = assets {
        router = router.fallback_service(ServeDir::new(assets));
    }
    let local = LocalOrigin {
        host: address.to_string(),
        origin: format!("http://{address}"),
    };
    router.layer(from_fn_with_state(local, guard_local_origin))
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
