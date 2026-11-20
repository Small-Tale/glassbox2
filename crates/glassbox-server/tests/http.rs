use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use glassbox_model::{DifftoolInput, ServiceHealth};

struct RunningServer(Child);

impl Drop for RunningServer {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl RunningServer {
    fn start(assets: Option<&Path>) -> (Self, SocketAddr) {
        Self::start_configured(assets, &[], None)
    }

    fn start_with_args(assets: Option<&Path>, args: &[&OsStr]) -> (Self, SocketAddr) {
        Self::start_configured(assets, args, None)
    }

    fn start_configured(
        assets: Option<&Path>,
        args: &[&OsStr],
        settings_directory: Option<&Path>,
    ) -> (Self, SocketAddr) {
        Self::start_in_environment(assets, args, settings_directory, &[])
    }

    fn start_in_environment(
        assets: Option<&Path>,
        args: &[&OsStr],
        settings_directory: Option<&Path>,
        environment: &[(&str, &OsStr)],
    ) -> (Self, SocketAddr) {
        let mut command = Command::new(env!("CARGO_BIN_EXE_glassbox-server"));
        command
            .env_remove("GLASSBOX_AI_PROVIDER_DIRECTORY")
            .env_remove("GLASSBOX_AI_PROVIDER")
            .env_remove("GLASSBOX_AI_MODEL")
            .env_remove("GLASSBOX_AI_MODEL_REVISION")
            .env_remove("GLASSBOX_ANALYSIS_CACHE_DIRECTORY")
            .env_remove("GLASSBOX_TEST_GENERATIONS")
            .env_remove("GLASSBOX_AI_PROVIDER_SETTINGS");
        for (key, value) in environment {
            command.env(key, value);
        }
        if let Some(path) = assets {
            command.arg("--assets").arg(path);
        }
        if let Some(directory) = settings_directory {
            command.env("GLASSBOX_SETTINGS_DIRECTORY", directory);
            command.env("GLASSBOX_FEEDBACK_DIRECTORY", directory.join("feedback"));
        }
        let child = command
            .args(args)
            .stdout(Stdio::piped())
            .spawn()
            .expect("start Glassbox service");
        let mut server = Self(child);
        let stdout = server.0.stdout.take().expect("capture service stdout");
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let mut line = String::new();
            let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
            let _ = sender.send(result);
        });
        let address = receiver
            .recv_timeout(Duration::from_secs(5))
            .expect("service published its bound address")
            .expect("read service address")
            .trim()
            .parse()
            .expect("valid socket address");
        (server, address)
    }
}

fn get(address: SocketAddr, path: &str) -> String {
    request(address, path, &address.to_string(), "")
}

fn request(address: SocketAddr, path: &str, host: &str, extra_headers: &str) -> String {
    exchange(address, "GET", path, host, extra_headers, "")
}

fn exchange(
    address: SocketAddr,
    method: &str,
    path: &str,
    host: &str,
    extra_headers: &str,
    body: &str,
) -> String {
    let timeout = Duration::from_secs(5);
    let mut connection = TcpStream::connect_timeout(&address, timeout).unwrap();
    connection.set_read_timeout(Some(timeout)).unwrap();
    connection.set_write_timeout(Some(timeout)).unwrap();
    write!(
        connection,
        "{method} {path} HTTP/1.1\r\nHost: {host}\r\n{extra_headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    let mut response = String::new();
    connection.read_to_string(&mut response).unwrap();
    response
}

#[test]
fn health_is_available_through_the_real_loopback_service() {
    let (_server, address) = RunningServer::start(None);
    assert!(IpAddr::is_loopback(&address.ip()));

    let response = get(address, "/api/v1/health");
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    assert!(headers.starts_with("HTTP/1.1 200 OK"));
    assert!(headers.contains("content-type: application/json"));
    assert_eq!(
        serde_json::from_str::<ServiceHealth>(body).unwrap(),
        ServiceHealth::ready()
    );
    assert!(get(address, "/api/v2/health").starts_with("HTTP/1.1 404 Not Found"));
}

#[test]
fn built_pages_and_assets_are_served_by_the_same_application_origin() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::create_dir(directory.path().join("ux-demo")).unwrap();
    std::fs::write(
        directory.path().join("index.html"),
        "<title>Glassbox</title>",
    )
    .unwrap();
    std::fs::write(
        directory.path().join("ux-demo/index.html"),
        "<title>Catalog</title>",
    )
    .unwrap();
    std::fs::write(directory.path().join("app.js"), "console.log('Glassbox');").unwrap();
    let (_host, address) = RunningServer::start(Some(directory.path()));
    assert!(get(address, "/").contains("<title>Glassbox</title>"));
    let catalog_redirect = get(address, "/ux-demo");
    assert!(catalog_redirect.starts_with("HTTP/1.1 307 Temporary Redirect"));
    assert!(catalog_redirect.contains("location: /ux-demo/"));
    assert!(get(address, "/ux-demo/").contains("<title>Catalog</title>"));
    let js = get(address, "/app.js");
    assert!(js.starts_with("HTTP/1.1 200 OK"));
    assert!(js.contains("javascript"));
    assert_eq!(
        request(address, "/api/v1/health", "host.example.test", "")
            .lines()
            .next(),
        Some("HTTP/1.1 403 Forbidden")
    );
    let disallowed = [
        "Origin: https://example.test\r\n",
        "Sec-Fetch-Site: cross-site\r\n",
    ];
    for extra in disallowed {
        assert!(
            request(address, "/api/v1/health", &address.to_string(), extra)
                .starts_with("HTTP/1.1 403 Forbidden")
        );
    }
}

#[test]
fn difftool_input_is_only_published_for_a_difftool_launch() {
    let (_ordinary, ordinary_address) = RunningServer::start(None);
    assert!(get(ordinary_address, "/api/v1/difftool").starts_with("HTTP/1.1 404 Not Found"));

    let before = OsStr::new("before with spaces & punctuation");
    let after = OsStr::new("after with spaces & punctuation");
    let (_server, address) =
        RunningServer::start_with_args(None, &[OsStr::new("--difftool"), before, after]);
    let response = get(address, "/api/v1/difftool");
    let (headers, body) = response.split_once("\r\n\r\n").unwrap();
    assert!(headers.starts_with("HTTP/1.1 200 OK"));
    let input = serde_json::from_str::<DifftoolInput>(body).unwrap();
    assert_eq!(input.before, std::path::absolute(before).unwrap());
    assert_eq!(input.after, std::path::absolute(after).unwrap());
    assert!(
        request(
            address,
            "/api/v1/difftool",
            &address.to_string(),
            "Origin: https://example.test\r\n"
        )
        .starts_with("HTTP/1.1 403 Forbidden")
    );
}

#[test]
fn appearance_round_trips_through_the_host_and_survives_restart() {
    let directory = tempfile::tempdir().unwrap();
    let file = directory.path().join("settings.json");
    let (server, address) = RunningServer::start_configured(None, &[], Some(directory.path()));
    let path = "/api/v1/settings";
    let json = "Content-Type: application/json\r\n";
    let put = |body| exchange(address, "PUT", path, &address.to_string(), json, body);

    assert!(get(address, path).ends_with(r#"{"appearance":"system"}"#));
    assert!(put(r#"{"appearance":"light"}"#).ends_with(r#"{"appearance":"light"}"#));
    assert!(put(r#"{"appearance":"dark"}"#).ends_with(r#"{"appearance":"dark"}"#));
    assert!(put("{}").starts_with("HTTP/1.1 422"));
    let foreign = format!("{json}Origin: https://foreign.example\r\n");
    assert!(
        exchange(
            address,
            "PUT",
            path,
            &address.to_string(),
            &foreign,
            r#"{"appearance":"system"}"#
        )
        .starts_with("HTTP/1.1 403")
    );
    assert!(std::fs::read_to_string(&file).unwrap().contains("dark"));
    drop(server);

    let (_server, address) = RunningServer::start_configured(None, &[], Some(directory.path()));
    assert!(get(address, path).ends_with(r#"{"appearance":"dark"}"#));
}

#[test]
fn desktop_file_actions_validate_comparison_path_and_reject_snapshots() {
    let root = tempfile::tempdir().unwrap();
    let before = root.path().join("before.txt");
    let after = root.path().join("after with spaces.txt");
    std::fs::write(&before, "before").unwrap();
    std::fs::write(&after, "after").unwrap();
    let (_server, address) = RunningServer::start_with_args(
        None,
        &[
            OsStr::new("--difftool"),
            before.as_os_str(),
            after.as_os_str(),
        ],
    );
    let request = |source: serde_json::Value, path: &str, action: &str| {
        exchange(
            address,
            "POST",
            "/api/v1/review/file/action",
            &address.to_string(),
            "Content-Type: application/json\r\n",
            &serde_json::json!({"source": source, "index": 0, "path": path, "action": action})
                .to_string(),
        )
    };
    let direct = serde_json::json!({"kind": "paths", "before": before, "after": after});
    let response = request(direct.clone(), "after with spaces.txt", "copy_absolute");
    assert!(response.starts_with("HTTP/1.1 200"), "{response}");
    let (_, body) = response.split_once("\r\n\r\n").unwrap();
    assert_eq!(
        serde_json::from_str::<std::path::PathBuf>(body).unwrap(),
        after
    );
    let stale = request(direct, "other.txt", "open");
    assert!(stale.starts_with("HTTP/1.1 400"), "{stale}");
    assert!(stale.contains("changed-file list has changed"));
    let snapshot = request(
        serde_json::json!({"kind": "difftool"}),
        "after with spaces.txt",
        "reveal",
    );
    assert!(snapshot.starts_with("HTTP/1.1 400"), "{snapshot}");
    assert!(snapshot.contains("without a verified live path"));
}

#[test]
fn discussion_publishes_edits_replies_and_attachments_and_rejects_stale_anchors() {
    use serde_json::{Value, json};

    let directory = tempfile::tempdir().unwrap();
    let before = directory.path().join("before.txt");
    let after = directory.path().join("after.txt");
    std::fs::write(&before, "before\n").unwrap();
    std::fs::write(&after, "after\n").unwrap();
    let (_host, address) = RunningServer::start_configured(None, &[], Some(directory.path()));
    let selection = json!({"source":{"kind":"paths","before":before,"after":after},"path":"after.txt","index":0});
    let post = |route: &str, value: Value| {
        let response = exchange(
            address,
            "POST",
            route,
            &address.to_string(),
            "Content-Type: application/json\r\n",
            &value.to_string(),
        );
        let (header, body) = response.split_once("\r\n\r\n").unwrap();
        (header[..12].to_string(), body.to_string())
    };
    let (status, file) = post("/api/v1/review/file", selection.clone());
    assert_eq!(status, "HTTP/1.1 200");
    let revision = serde_json::from_str::<Value>(&file).unwrap()["revision"].clone();
    let discuss = |operation: Value| {
        post(
            "/api/v1/review/discussion",
            json!({"selection":selection,"operation":operation}),
        )
    };
    let prepare = || post("/api/v1/review/handoff", selection["source"].clone());
    let (status, first_instruction) = prepare();
    assert_eq!(status, "HTTP/1.1 200");
    let instruction: String = serde_json::from_str(&first_instruction).unwrap();
    assert!(instruction.contains("review.md"));
    let create = |markdown| {
        json!({
            "kind":"create", "author":"Reviewer", "markdown":markdown, "category":"style",
            "anchor":{"path":"after.txt","side":"after","revision":revision,"target":{"kind":"line","start":1,"end":1}},
        })
    };
    let (status, _) = discuss(create("First"));
    assert_eq!(status, "HTTP/1.1 200");
    let (status, list) = discuss(create("Second"));
    assert_eq!(status, "HTTP/1.1 200");
    let list: Value = serde_json::from_str(&list).unwrap();
    assert_eq!(list["threads"].as_array().unwrap().len(), 2);
    let (status, _) = discuss(
        json!({"kind":"apply","id":1,"revision":1,"change":{"kind":"reply","author":"Other reviewer","markdown":"Reply"}}),
    );
    assert_eq!(status, "HTTP/1.1 200");
    let (status, list) = discuss(
        json!({"kind":"attach","id":1,"revision":2,"filename":"evidence.txt","content":"dGVzdA=="}),
    );
    assert_eq!(status, "HTTP/1.1 200");
    let list: Value = serde_json::from_str(&list).unwrap();
    assert_eq!(
        list["threads"][0]["opening"]["attachments"][0]["filename"],
        "evidence.txt"
    );
    assert!(
        list["threads"][0]["opening"]["attachments"][0]
            .get("bytes")
            .is_none()
    );
    assert_eq!(
        list["threads"][0]["replies"][0]["message"]["author"],
        "Other reviewer"
    );
    assert_eq!(list["threads"][1]["replies"].as_array().unwrap().len(), 0);
    let (status, _) =
        discuss(json!({"kind":"apply","id":1,"revision":1,"change":{"kind":"remove_thread"}}));
    assert_eq!(status, "HTTP/1.1 409");

    std::fs::write(&after, "a new revision\n").unwrap();
    assert_eq!(discuss(create("Stale line")).0, "HTTP/1.1 409");
    let (status, updated_instruction) = prepare();
    assert_eq!(status, "HTTP/1.1 200");
    assert_eq!(updated_instruction, first_instruction);
    assert_eq!(
        std::fs::read_dir(directory.path().join("feedback"))
            .unwrap()
            .count(),
        1
    );
    let stored = std::fs::read_dir(directory.path().join("feedback"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let markdown = std::fs::read_to_string(stored.join("review.md")).unwrap();
    assert!(
        markdown.contains("First")
            && markdown.contains("Second")
            && markdown.contains("evidence.txt")
    );
}

#[test]
#[ignore = "requires a current local Hot Sheet CLI"]
fn export_sends_to_a_new_and_an_existing_ticket_without_replaying_delivery() {
    use serde_json::{Value, json};
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("export.hs2");
    std::fs::create_dir(&store).unwrap();
    let cli = |args: &[&str]| {
        let output = Command::new("hotsheet-cli")
            .arg("-C")
            .arg(&store)
            .args(args)
            .args(["--actor-role=human", "--actor-id=glassbox-test"])
            .env_remove("HOTSHEET_STORE")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap()
    };
    cli(&["init", "--prefix=GBEXP"]);
    let before = scratch.path().join("before.txt");
    let after = scratch.path().join("after.txt");
    std::fs::write(&before, "before\n").unwrap();
    std::fs::write(&after, "after\n").unwrap();
    let (_host, address) = RunningServer::start_configured(None, &[], Some(scratch.path()));
    let source = json!({"kind":"paths","before":before,"after":after});
    let route = |path: &str, input: Value| {
        let response = exchange(
            address,
            "POST",
            path,
            &address.to_string(),
            "Content-Type: application/json\r\n",
            &input.to_string(),
        );
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        assert!(head.starts_with("HTTP/1.1 200"), "{response}");
        serde_json::from_str::<Value>(body).unwrap()
    };
    let created = json!({"id":"00000000-0000-0000-0000-000000000001","source":source,"destination":store,
        "request":{"target":{"kind":"new"},"title":"Fixture review","summary":"First delivery"}});
    let receipt = route("/api/v1/review/export/send", created.clone());
    assert_eq!(route("/api/v1/review/export/send", created), receipt);
    let ticket = receipt["ticket"].as_str().unwrap();
    let preview = route(
        "/api/v1/review/export/preview",
        json!({"source":source,"destination":store,"recent":true}),
    );
    assert_eq!(preview["recent"][0]["slug"], ticket);
    let appended = route(
        "/api/v1/review/export/send",
        json!({"id":"00000000-0000-0000-0000-000000000002","source":source,
        "destination":store,"request":{"target":{"kind":"existing","reference":ticket},"summary":"Second delivery"}}),
    );
    assert_eq!(appended["ticket"], ticket);
    assert_ne!(appended["batch_id"], receipt["batch_id"]);
    let written = cli(&["show", ticket]);
    assert_eq!(written.matches("First delivery").count(), 1);
    assert_eq!(written.matches("Second delivery").count(), 1);
    assert!(written.contains("status: not_started"));
}

#[test]
fn analysis_uses_provider_jobs_with_progress_results_cancellation_stale_and_unavailable_states() {
    use serde_json::{Value, json};

    let root = tempfile::tempdir().unwrap();
    let registry = root.path().join("providers");
    std::fs::create_dir(&registry).unwrap();
    let program = root
        .path()
        .join(format!("fixture-provider{}", std::env::consts::EXE_SUFFIX));
    let source_code =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/analysis_provider.rs");
    let rustc = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
    let compile = Command::new(rustc)
        .arg("--edition=2024")
        .arg(source_code)
        .arg("-o")
        .arg(&program)
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let manifest = json!({"version":1,"id":"fixture","name":"Fixture","executable":program});
    std::fs::write(registry.join("fixture.json"), manifest.to_string()).unwrap();

    let before = root.path().join("before.txt");
    let after = root.path().join("after.txt");
    std::fs::write(&before, "before\n").unwrap();
    std::fs::write(&after, "after\n").unwrap();
    let source = json!({"kind":"paths","before":before,"after":after});
    let counter = root.path().join("generation-count");
    let cache = root.path().join("analysis-cache");
    let environment = [
        ("GLASSBOX_AI_PROVIDER_DIRECTORY", registry.as_os_str()),
        ("GLASSBOX_AI_PROVIDER", OsStr::new("fixture")),
        ("GLASSBOX_AI_MODEL_REVISION", OsStr::new("fixture-revision")),
        ("GLASSBOX_ANALYSIS_CACHE_DIRECTORY", cache.as_os_str()),
        ("GLASSBOX_TEST_GENERATIONS", counter.as_os_str()),
    ];
    let (_host, address) =
        RunningServer::start_in_environment(None, &[], Some(root.path()), &environment);
    let (_disabled_host, disabled_address) =
        RunningServer::start_configured(None, &[], Some(root.path()));
    let call = |address: SocketAddr, method: &str, path: &str, input: Value| {
        let body = if input.is_null() {
            String::new()
        } else {
            input.to_string()
        };
        let response = exchange(
            address,
            method,
            path,
            &address.to_string(),
            "Content-Type: application/json\r\n",
            &body,
        );
        let (head, serialized) = response.split_once("\r\n\r\n").unwrap();
        assert!(head.starts_with("HTTP/1.1 200"), "{response}");
        serde_json::from_str::<Value>(serialized).unwrap()
    };
    let start = |address, mode| {
        let accepted = call(
            address,
            "POST",
            "/api/v1/review/analysis",
            json!({"source":source,"mode":mode}),
        );
        assert_eq!(accepted["status"], "running");
        format!("/api/v1/review/analysis/{}", accepted["id"])
    };
    let wait_for = |address, endpoint: &str, predicate: fn(&Value) -> bool| {
        let deadline = std::time::Instant::now() + Duration::from_secs(8);
        loop {
            let state = call(address, "GET", endpoint, Value::Null);
            if predicate(&state) {
                break state;
            }
            assert!(std::time::Instant::now() < deadline, "{state}");
            std::thread::sleep(Duration::from_millis(15));
        }
    };
    let done = |state: &Value| state["status"] != "running";
    let ready = |state: &Value| state["total"] == 1 || state["status"] != "running";

    let risk = start(address, "risk");
    let simultaneous = start(address, "risk");
    let result = wait_for(address, &risk, done);
    assert_eq!(
        wait_for(address, &simultaneous, done)["result"],
        result["result"]
    );
    assert_eq!(
        std::fs::read_to_string(&counter).unwrap().lines().count(),
        1
    );
    let (_restart, restarted) =
        RunningServer::start_in_environment(None, &[], Some(root.path()), &environment);
    assert_eq!(
        wait_for(restarted, &start(restarted, "risk"), done)["result"],
        result["result"]
    );
    assert_eq!(
        std::fs::read_to_string(&counter).unwrap().lines().count(),
        1
    );
    let mut updated_environment = environment;
    updated_environment[2].1 = OsStr::new("different-model-revision");
    let (_updated, updated) =
        RunningServer::start_in_environment(None, &[], Some(root.path()), &updated_environment);
    assert_eq!(
        wait_for(updated, &start(updated, "risk"), done)["status"],
        "complete"
    );
    assert_eq!(
        std::fs::read_to_string(&counter).unwrap().lines().count(),
        2
    );

    assert_eq!(result["status"], "complete", "{result}");
    let file = &result["result"]["files"][0];
    assert_eq!(file["path"], "after.txt");
    assert!(
        file["analysis"]["aggregate"]
            .as_f64()
            .is_some_and(|score| (score - 0.6).abs() < 0.0001)
    );
    assert_eq!(
        file["analysis"]["observations"].as_array().unwrap().len(),
        1
    );
    let discussion = call(
        address,
        "POST",
        "/api/v1/review/discussion",
        json!({"selection":{"source":source,"index":0,"path":"after.txt"}}),
    );
    assert_eq!(discussion["threads"][0]["origin"]["kind"], "ai");
    assert_eq!(
        discussion["threads"][0]["anchor"]["revision"],
        file["revision"]
    );

    let guide = start(address, "guidance");
    let result = wait_for(address, &guide, done);
    assert_eq!(
        result["result"]["files"][0]["analysis"]["steps"][0]["text"],
        "Read the new value."
    );
    let narrative = start(address, "narrative");
    let result = wait_for(address, &narrative, done);
    assert_eq!(result["result"]["narrative"][0]["path"], "after.txt");

    std::fs::write(&after, "changed before cancellation\n").unwrap();
    let cancelled = start(address, "guidance");
    assert_eq!(wait_for(address, &cancelled, ready)["status"], "running");
    assert_eq!(
        call(address, "DELETE", &cancelled, Value::Null)["status"],
        "cancelled"
    );
    let stale = start(address, "risk");
    assert_eq!(wait_for(address, &stale, ready)["status"], "running");
    std::fs::write(&after, "another revision\n").unwrap();
    assert_eq!(wait_for(address, &stale, done)["status"], "stale");
    assert_eq!(
        call(address, "GET", &cancelled, Value::Null)["status"],
        "cancelled"
    );

    std::fs::write(&after, "INVALID_FIXTURE\n").unwrap();
    let malformed = start(address, "risk");
    assert_eq!(wait_for(address, &malformed, done)["status"], "failed");

    let before_folder = root.path().join("before-folder");
    let after_folder = root.path().join("after-folder");
    std::fs::create_dir(&before_folder).unwrap();
    std::fs::create_dir(&after_folder).unwrap();
    for path in ["healthy.ts", "unreliable.ts"] {
        std::fs::write(before_folder.join(path), "old\n").unwrap();
    }
    std::fs::write(after_folder.join("healthy.ts"), "new\n").unwrap();
    std::fs::write(after_folder.join("unreliable.ts"), "INVALID_FIXTURE\n").unwrap();
    let folder = json!({"kind":"paths","before":before_folder,"after":after_folder});
    let start_folder = || {
        let accepted = call(
            address,
            "POST",
            "/api/v1/review/analysis",
            json!({"source":folder,"mode":"guidance"}),
        );
        format!("/api/v1/review/analysis/{}", accepted["id"])
    };
    let partial = wait_for(address, &start_folder(), done);
    assert_eq!(partial["status"], "partial", "{partial}");
    assert_eq!(partial["result"]["files"][0]["path"], "healthy.ts");
    assert_eq!(partial["result"]["failures"][0]["path"], "unreliable.ts");
    std::fs::write(after_folder.join("unreliable.ts"), "INVALID_ONCE\n").unwrap();
    let recovered = wait_for(address, &start_folder(), done);
    assert_eq!(recovered["status"], "complete", "{recovered}");
    assert_eq!(recovered["result"]["files"].as_array().unwrap().len(), 2);

    let unavailable = start(disabled_address, "risk");
    assert_eq!(
        wait_for(disabled_address, &unavailable, done)["status"],
        "unavailable"
    );
}

#[test]
fn feedback_cleanup_requires_confirmation_and_protects_active_bundles() {
    use glassbox_feedback::{BundleContext, BundleStore};
    use glassbox_model::feedback::ReviewFeedback;
    use serde_json::{Value, json};

    let root = tempfile::tempdir().unwrap();
    let first = root.path().join("first");
    let second = root.path().join("second");
    std::fs::create_dir(&first).unwrap();
    std::fs::create_dir(&second).unwrap();
    let storage = BundleStore::in_directory(root.path().join("feedback"));
    let make = |project| {
        storage
            .create(
                BundleContext {
                    project: Some(project),
                    comparison: "Working tree".into(),
                    before: None,
                    after: None,
                },
                &ReviewFeedback::default(),
            )
            .unwrap()
    };
    let old = make(first.clone());
    let old_path = old.path();
    drop(old);
    let active = make(second);
    let (_host, address) = RunningServer::start_configured(None, &[], Some(root.path()));
    let parse = |response: &str| {
        serde_json::from_str::<Value>(response.split_once("\r\n\r\n").unwrap().1).unwrap()
    };
    let usage = || parse(&get(address, "/api/v1/feedback/storage"));
    let cleanup = |scope, confirmed| {
        exchange(
            address,
            "POST",
            "/api/v1/feedback/storage/cleanup",
            &address.to_string(),
            "Content-Type: application/json\r\n",
            &json!({"scope":scope,"confirmed":confirmed}).to_string(),
        )
    };
    assert_eq!(usage()["bundles"], 2);
    assert!(cleanup(json!({"kind":"all"}), false).starts_with("HTTP/1.1 400"));
    assert!(old_path.exists());
    let report = parse(&cleanup(json!({"kind":"project","project":first}), true));
    assert_eq!(report["removed_bundles"], 1);
    assert!(!old_path.exists());
    let report = parse(&cleanup(json!({"kind":"all"}), true));
    assert_eq!(report["active_bundles"], 1);
    assert!(active.path().exists());
    assert_eq!(usage()["bundles"], 1);
    drop(active);
    assert_eq!(
        parse(&cleanup(json!({"kind":"all"}), true))["removed_bundles"],
        1
    );
    assert_eq!(usage()["bundles"], 0);
}
