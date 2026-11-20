use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use glassbox_ai::{Failure, Outcome, ProviderError, Request, discover, invoke};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

const EXECUTABLE: &str = env!("CARGO_BIN_EXE_glassbox-provider-local");
const TEST_TIMEOUT: Duration = Duration::from_secs(5);

fn settings(address: std::net::SocketAddr) -> BTreeMap<String, Value> {
    BTreeMap::from([("address".into(), json!(address.to_string()))])
}

#[test]
fn discovery_is_inert_and_rejects_duplicate_ids_and_versions() {
    let directory = tempfile::tempdir().unwrap();
    let first = directory.path().join("first.json");
    let second = directory.path().join("second.json");
    let mut manifest = json!({
        "version": 1, "id": "local", "name": "Local",
        "executable": directory.path().join("absent executable"),
    });
    std::fs::write(&first, manifest.to_string()).unwrap();
    assert!(discover(directory.path()).unwrap().contains_key("local"));
    std::fs::write(&second, manifest.to_string()).unwrap();
    assert!(
        matches!(discover(directory.path()), Err(ProviderError::DuplicateId(id)) if id == "local")
    );
    manifest["version"] = json!(2);
    std::fs::write(&second, manifest.to_string()).unwrap();
    assert!(matches!(
        discover(directory.path()),
        Err(ProviderError::UnsupportedVersion(2))
    ));
}

async fn read_request(stream: TcpStream) -> (TcpStream, String, Vec<u8>) {
    let mut stream = BufReader::new(stream);
    let mut head = String::new();
    stream.read_line(&mut head).await.unwrap();
    let mut length = 0;
    loop {
        let mut line = String::new();
        stream.read_line(&mut line).await.unwrap();
        if line == "\r\n" || line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once(':') {
            if key.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse().unwrap();
            }
        }
    }
    let mut body = vec![0; length];
    stream.read_exact(&mut body).await.unwrap();
    (stream.into_inner(), head, body)
}

async fn respond(mut stream: TcpStream, status: &str, body: Value) {
    let body = body.to_string();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).await.unwrap();
}

#[tokio::test]
async fn adapter_discovers_models_generates_and_maps_rejections() {
    let http = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = settings(http.local_addr().unwrap());
    let fixture = tokio::spawn(async move {
        let (stream, _) = http.accept().await.unwrap();
        let (stream, route, _) = read_request(stream).await;
        assert!(route.starts_with("GET /v1/models "));
        respond(stream, "200 OK", json!({"data": [{"id": "fixture-model"}]})).await;

        let (stream, _) = http.accept().await.unwrap();
        let (stream, route, body) = read_request(stream).await;
        assert!(route.starts_with("POST /v1/chat/completions "));
        let body: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body["model"], "fixture-model");
        assert_eq!(body["messages"][1]["content"], "Hello");
        respond(
            stream,
            "200 OK",
            json!({"choices": [{"message": {"content": "Hello back"}}]}),
        )
        .await;

        let (stream, _) = http.accept().await.unwrap();
        let (stream, _, _) = read_request(stream).await;
        respond(stream, "401 Unauthorized", json!({})).await;
    });
    let executable = Path::new(EXECUTABLE);
    assert_eq!(
        invoke(
            executable,
            Request::ListModels,
            config.clone(),
            TEST_TIMEOUT
        )
        .await
        .unwrap(),
        Outcome::Models {
            models: vec!["fixture-model".into()]
        },
    );
    let request = Request::Generate {
        model: "fixture-model".into(),
        system: "Answer briefly.".into(),
        prompt: "Hello".into(),
    };
    assert_eq!(
        invoke(executable, request, config.clone(), TEST_TIMEOUT)
            .await
            .unwrap(),
        Outcome::Generated {
            text: "Hello back".into()
        },
    );
    assert!(matches!(
        invoke(executable, Request::ListModels, config, TEST_TIMEOUT).await,
        Err(ProviderError::Backend(Failure::AuthenticationRequired)),
    ));
    fixture.await.unwrap();
}

#[tokio::test]
async fn provider_times_out_and_cancellation_closes_its_connection() {
    let http = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let config = settings(http.local_addr().unwrap());
    let executable = Path::new(EXECUTABLE);
    let call = tokio::spawn(invoke(
        executable,
        Request::ListModels,
        config.clone(),
        TEST_TIMEOUT,
    ));
    let (stream, _) = tokio::time::timeout(TEST_TIMEOUT, http.accept())
        .await
        .unwrap()
        .unwrap();
    let (mut stream, _, _) = read_request(stream).await;
    call.abort();
    assert!(call.await.unwrap_err().is_cancelled());
    let read = tokio::time::timeout(TEST_TIMEOUT, stream.read_u8())
        .await
        .unwrap();
    assert!(matches!(
        read.unwrap_err().kind(),
        std::io::ErrorKind::UnexpectedEof | std::io::ErrorKind::ConnectionReset
    ));

    assert!(matches!(
        invoke(
            executable,
            Request::ListModels,
            config,
            Duration::from_millis(50)
        )
        .await,
        Err(ProviderError::Timeout),
    ));
}

#[tokio::test]
#[ignore = "requires a local inference engine with an installed model"]
async fn real_provider_smoke() {
    let address = std::env::var("GLASSBOX_LOCAL_AI_SMOKE_ADDRESS")
        .unwrap_or_else(|_| "127.0.0.1:11434".into())
        .parse()
        .unwrap();
    let config = settings(address);
    let command =
        std::env::var_os("GLASSBOX_AI_SMOKE_EXECUTABLE").unwrap_or_else(|| EXECUTABLE.into());
    let executable = Path::new(&command);
    let Outcome::Models { models } = invoke(
        executable,
        Request::ListModels,
        config.clone(),
        TEST_TIMEOUT,
    )
    .await
    .unwrap() else {
        panic!("model list expected");
    };
    let model = models
        .into_iter()
        .next()
        .expect("at least one installed model");
    let request = Request::Generate {
        model,
        system: "Reply briefly.".into(),
        prompt: "Say hello.".into(),
    };
    let Outcome::Generated { text } = invoke(executable, request, config, Duration::from_secs(90))
        .await
        .unwrap()
    else {
        panic!("model text expected");
    };
    assert!(!text.trim().is_empty());
}
