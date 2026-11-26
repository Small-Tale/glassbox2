//! Readiness of the local diagram renderers (HS2-Q9TXER).
//!
//! The report reads the host's own environment and the file system and runs nothing: it says what the
//! renderer contract in `docs/content-plugins.md` needs and which parts are missing. Installing a tool and
//! trusting it stay with the person who starts the host.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use axum::Json;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

const RENDERER: &str = "GLASSBOX_CONTENT_RENDERER";
const LOCAL_ADAPTER: &str = "glassbox-render-local";

#[derive(Serialize)]
struct Readiness {
    renderer: Renderer,
    formats: Vec<Format>,
}

#[derive(Serialize)]
struct Renderer {
    /// `not_configured`, `missing`, `local` (the bundled adapter) or `custom` (any other trusted executable).
    state: &'static str,
    variable: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

#[derive(Serialize)]
struct Format {
    id: &'static str,
    name: &'static str,
    extensions: &'static [&'static str],
    /// `ready`, `needs_setup`, `unavailable` (no usable renderer) or `unchecked` (a custom renderer owns its tools).
    state: &'static str,
    requirements: Vec<Requirement>,
    install: &'static str,
}

#[derive(Serialize)]
struct Requirement {
    label: &'static str,
    variable: &'static str,
    /// `ok`, `unset`, `relative` (not an absolute path) or `missing` (no such file).
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

struct Environment {
    renderer: Option<OsString>,
    variables: Vec<(&'static str, Option<OsString>)>,
}

fn requirement(
    environment: &Environment,
    label: &'static str,
    variable: &'static str,
) -> Requirement {
    let value = environment
        .variables
        .iter()
        .find_map(|(name, value)| (*name == variable).then_some(value.as_ref()))
        .flatten()
        .filter(|value| !value.is_empty());
    let (state, path) = match value {
        None => ("unset", None),
        Some(value) => {
            let path = PathBuf::from(value);
            let state = if !path.is_absolute() {
                "relative"
            } else if path.is_file() {
                "ok"
            } else {
                "missing"
            };
            (state, Some(path.to_string_lossy().into_owned()))
        }
    };
    Requirement {
        label,
        variable,
        state,
        path,
    }
}

fn readiness(environment: &Environment) -> Readiness {
    let renderer_path = environment
        .renderer
        .as_ref()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let state = match &renderer_path {
        None => "not_configured",
        Some(path) if !path.is_absolute() || !path.is_file() => "missing",
        Some(path) if is_local_adapter(path) => "local",
        Some(_) => "custom",
    };
    let formats = [
        (
            "graphviz",
            "Graphviz",
            &[".dot", ".gv"][..],
            vec![("Graphviz dot executable", "GLASSBOX_GRAPHVIZ_EXECUTABLE")],
            "https://graphviz.org/download/",
        ),
        (
            "mermaid",
            "Mermaid",
            &[".mmd", ".mermaid"][..],
            vec![("Mermaid CLI executable", "GLASSBOX_MERMAID_EXECUTABLE")],
            "https://github.com/mermaid-js/mermaid-cli",
        ),
        (
            "plantuml",
            "PlantUML",
            &[".puml", ".plantuml"][..],
            vec![
                ("Java executable", "GLASSBOX_JAVA_EXECUTABLE"),
                ("PlantUML jar", "GLASSBOX_PLANTUML_JAR"),
            ],
            "https://plantuml.com/download",
        ),
    ]
    .into_iter()
    .map(|(id, name, extensions, needs, install)| {
        let requirements: Vec<Requirement> = needs
            .into_iter()
            .map(|(label, variable)| requirement(environment, label, variable))
            .collect();
        let state = match state {
            "not_configured" | "missing" => "unavailable",
            "custom" => "unchecked",
            _ if requirements.iter().all(|need| need.state == "ok") => "ready",
            _ => "needs_setup",
        };
        Format {
            id,
            name,
            extensions,
            state,
            requirements: if state == "unchecked" || state == "unavailable" {
                Vec::new()
            } else {
                requirements
            },
            install,
        }
    })
    .collect();
    Readiness {
        renderer: Renderer {
            state,
            variable: RENDERER,
            path: renderer_path.map(|path| path.to_string_lossy().into_owned()),
        },
        formats,
    }
}

fn is_local_adapter(path: &Path) -> bool {
    path.file_stem()
        .is_some_and(|stem| stem.to_string_lossy() == LOCAL_ADAPTER)
}

/// Re-reads the paths each call, so a tool installed after launch is noticed; the variables themselves are
/// those the host started with.
pub(crate) async fn report() -> Response {
    let environment = Environment {
        renderer: std::env::var_os(RENDERER),
        variables: [
            "GLASSBOX_GRAPHVIZ_EXECUTABLE",
            "GLASSBOX_MERMAID_EXECUTABLE",
            "GLASSBOX_JAVA_EXECUTABLE",
            "GLASSBOX_PLANTUML_JAR",
        ]
        .into_iter()
        .map(|name| (name, std::env::var_os(name)))
        .collect(),
    };
    match tokio::task::spawn_blocking(move || readiness(&environment)).await {
        Ok(report) => Json(report).into_response(),
        Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn environment(renderer: Option<&Path>, tools: &[(&'static str, &Path)]) -> Environment {
        Environment {
            renderer: renderer.map(|path| path.as_os_str().to_owned()),
            variables: [
                "GLASSBOX_GRAPHVIZ_EXECUTABLE",
                "GLASSBOX_MERMAID_EXECUTABLE",
                "GLASSBOX_JAVA_EXECUTABLE",
                "GLASSBOX_PLANTUML_JAR",
            ]
            .into_iter()
            .map(|name| {
                let value = tools.iter().find_map(|(variable, path)| {
                    (*variable == name).then(|| path.as_os_str().to_owned())
                });
                (name, value)
            })
            .collect(),
        }
    }

    fn format<'a>(report: &'a Readiness, id: &str) -> &'a Format {
        report
            .formats
            .iter()
            .find(|format| format.id == id)
            .unwrap()
    }

    fn file(directory: &Path, name: &str) -> PathBuf {
        let path = directory.join(name);
        std::fs::write(&path, b"x").unwrap();
        path
    }

    #[test]
    fn without_a_renderer_every_format_is_unavailable_and_says_which_variable_to_set() {
        let report = readiness(&environment(None, &[]));
        assert_eq!(report.renderer.state, "not_configured");
        assert_eq!(report.renderer.variable, "GLASSBOX_CONTENT_RENDERER");
        assert!(
            report
                .formats
                .iter()
                .all(|format| format.state == "unavailable")
        );
        assert_eq!(report.formats.len(), 3);
    }

    #[test]
    fn a_renderer_path_that_is_not_a_file_is_missing() {
        let scratch = tempfile::tempdir().unwrap();
        let absent = scratch.path().join(LOCAL_ADAPTER);
        assert_eq!(
            readiness(&environment(Some(&absent), &[])).renderer.state,
            "missing"
        );
        assert_eq!(
            readiness(&environment(Some(Path::new("relative/renderer")), &[]))
                .renderer
                .state,
            "missing"
        );
        assert_eq!(
            readiness(&environment(Some(scratch.path()), &[]))
                .renderer
                .state,
            "missing"
        );
    }

    #[test]
    fn the_local_adapter_reports_each_format_by_its_tools() {
        let scratch = tempfile::tempdir().unwrap();
        let adapter = file(scratch.path(), LOCAL_ADAPTER);
        let dot = file(scratch.path(), "dot");
        let java = file(scratch.path(), "java");
        let jar = scratch.path().join("plantuml.jar");
        let report = readiness(&environment(
            Some(&adapter),
            &[
                ("GLASSBOX_GRAPHVIZ_EXECUTABLE", &dot),
                ("GLASSBOX_JAVA_EXECUTABLE", &java),
                ("GLASSBOX_PLANTUML_JAR", &jar),
            ],
        ));
        assert_eq!(report.renderer.state, "local");
        assert_eq!(format(&report, "graphviz").state, "ready");
        assert_eq!(format(&report, "graphviz").requirements[0].state, "ok");
        // Mermaid has no variable; PlantUML has Java but its jar does not exist yet.
        assert_eq!(format(&report, "mermaid").state, "needs_setup");
        assert_eq!(format(&report, "mermaid").requirements[0].state, "unset");
        assert_eq!(
            format(&report, "mermaid").requirements[0].variable,
            "GLASSBOX_MERMAID_EXECUTABLE"
        );
        let plantuml = format(&report, "plantuml");
        assert_eq!(plantuml.state, "needs_setup");
        assert_eq!(
            plantuml
                .requirements
                .iter()
                .map(|need| need.state)
                .collect::<Vec<_>>(),
            ["ok", "missing"]
        );
        assert!(
            plantuml.requirements[1]
                .path
                .as_deref()
                .is_some_and(|path| path.ends_with("plantuml.jar"))
        );

        // Installing the jar after launch is noticed by the next report.
        file(scratch.path(), "plantuml.jar");
        let again = readiness(&environment(
            Some(&adapter),
            &[
                ("GLASSBOX_GRAPHVIZ_EXECUTABLE", &dot),
                ("GLASSBOX_JAVA_EXECUTABLE", &java),
                ("GLASSBOX_PLANTUML_JAR", &jar),
            ],
        ));
        assert_eq!(format(&again, "plantuml").state, "ready");
    }

    #[test]
    fn a_relative_tool_path_is_refused_like_the_adapter_refuses_it() {
        let scratch = tempfile::tempdir().unwrap();
        let adapter = file(scratch.path(), LOCAL_ADAPTER);
        let report = readiness(&environment(
            Some(&adapter),
            &[("GLASSBOX_GRAPHVIZ_EXECUTABLE", Path::new("dot"))],
        ));
        let need = &format(&report, "graphviz").requirements[0];
        assert_eq!(
            (need.state, need.path.as_deref()),
            ("relative", Some("dot"))
        );
        assert_eq!(format(&report, "graphviz").state, "needs_setup");
    }

    #[test]
    fn a_custom_renderer_owns_its_tools_so_formats_are_unchecked() {
        let scratch = tempfile::tempdir().unwrap();
        let custom = file(scratch.path(), "my-renderer");
        let report = readiness(&environment(Some(&custom), &[]));
        assert_eq!(report.renderer.state, "custom");
        assert!(
            report
                .formats
                .iter()
                .all(|format| format.state == "unchecked" && format.requirements.is_empty())
        );
    }
}
