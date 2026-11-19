// A separate test binary keeps HTTP fixtures from acquiring the ephemeral
// port between stopping the embedded host and rebinding its address.
#[tokio::test]
async fn embedding_host_releases_its_listener_when_stopped() {
    let host = glassbox_server::LocalHost::start(None).await.unwrap();
    let address = host.address();
    assert!(tokio::net::TcpListener::bind(address).await.is_err());

    host.stop().await.unwrap();

    let _replacement = tokio::net::TcpListener::bind(address)
        .await
        .expect("the stopped host releases its listener");
}
