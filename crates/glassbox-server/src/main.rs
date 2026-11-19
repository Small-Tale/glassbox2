use std::io;
use std::net::{Ipv4Addr, SocketAddrV4};

use axum::{Json, Router, routing::get};
use glassbox_model::ServiceHealth;
use tokio::net::TcpListener;

#[tokio::main(flavor = "current_thread")]
async fn main() -> io::Result<()> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0)).await?;
    let address = listener.local_addr()?;
    let router = Router::new().route("/api/v1/health", get(health));
    println!("{address}");
    axum::serve(listener, router).await
}

async fn health() -> Json<ServiceHealth> {
    Json(ServiceHealth::ready())
}
