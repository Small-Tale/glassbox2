use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{Value, json};

fn invoke(format: &str, source: &str, environment: &[(&str, &Path)]) -> Value {
    let mut command = Command::new(env!("CARGO_BIN_EXE_glassbox-render-local"));
    for name in [
        "GLASSBOX_GRAPHVIZ_EXECUTABLE",
        "GLASSBOX_MERMAID_EXECUTABLE",
        "GLASSBOX_JAVA_EXECUTABLE",
        "GLASSBOX_PLANTUML_JAR",
    ] {
        command.env_remove(name);
    }
    command.envs(environment.iter().copied());
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            json!({ "version": 1, "format": format, "source": source })
                .to_string()
                .as_bytes(),
        )
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn renders_three_formats_and_rejects_missing_invalid_and_oversized_results() {
    let scratch = tempfile::tempdir().unwrap();
    let executable = scratch
        .path()
        .join(format!("fixture tool{}", std::env::consts::EXE_SUFFIX));
    let jar = scratch.path().join("fixture.jar");
    std::fs::write(&jar, "").unwrap();
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tool.rs");
    let compiler = std::env::var_os("RUSTC").unwrap_or_else(|| "rustc".into());
    assert!(
        Command::new(compiler)
            .arg(fixture)
            .args(["--edition", "2024", "-o"])
            .arg(&executable)
            .status()
            .unwrap()
            .success()
    );

    let environment = [
        ("GLASSBOX_GRAPHVIZ_EXECUTABLE", executable.as_path()),
        ("GLASSBOX_MERMAID_EXECUTABLE", executable.as_path()),
        ("GLASSBOX_JAVA_EXECUTABLE", executable.as_path()),
        ("GLASSBOX_PLANTUML_JAR", jar.as_path()),
    ];
    for format in ["graphviz", "mermaid", "plantuml"] {
        let source = "Input ☃";
        let result = invoke(format, source, &environment);
        assert_eq!(result["version"], 1);
        assert_eq!(
            result["outcome"]["status"], "rendered",
            "{format}: {result}"
        );
        assert!(result["outcome"]["svg"].as_str().unwrap().contains(source));
    }
    for source in ["invalid", "oversized"] {
        assert_eq!(
            invoke("mermaid", source, &environment)["outcome"]["status"],
            "unavailable"
        );
    }
    assert_eq!(
        invoke("graphviz", "graph", &[])["outcome"]["status"],
        "unavailable"
    );
    assert_eq!(
        invoke("graphviz", &"x".repeat(1024 * 1024 + 1), &environment)["outcome"]["status"],
        "unavailable"
    );
}

#[test]
#[ignore = "requires the three local diagram tools"]
fn renders_real_tools() {
    let names = [
        "GLASSBOX_GRAPHVIZ_EXECUTABLE",
        "GLASSBOX_MERMAID_EXECUTABLE",
        "GLASSBOX_JAVA_EXECUTABLE",
        "GLASSBOX_PLANTUML_JAR",
    ];
    let paths: Vec<_> = names
        .iter()
        .map(|name| std::path::PathBuf::from(std::env::var_os(name).unwrap()))
        .collect();
    let environment: Vec<_> = names
        .into_iter()
        .zip(paths.iter().map(|path| path.as_path()))
        .collect();
    for (format, source) in [
        ("graphviz", "digraph { a -> b }"),
        ("mermaid", "flowchart TD\nA --> B"),
        ("plantuml", "@startuml\nAlice -> Bob: Hello\n@enduml"),
    ] {
        let reply = invoke(format, source, &environment);
        assert_eq!(reply["outcome"]["status"], "rendered", "{format}: {reply}");
        assert!(reply["outcome"]["svg"].as_str().unwrap().contains("<svg"));
    }
}
